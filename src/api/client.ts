import type { Filters, SortKey, StageFilter } from '../domain/filters';
import type { MoveOp, MoveResult, RemoteChange, Stage } from '../domain/types';
import { NetworkError, type FakeServer, type PageResult, type SnapshotIds } from './fakeServer';

/**
 * What the app needs from a backend. The store only talks to this interface,
 * so it doesn't care whether the server is across the network or in the same process.
 */
export interface PageQuery {
  filters: Filters;
  me: string;
  /** 1-based */
  page: number;
  limit: number;
  /** from the first page's response; keeps later pages consistent with it */
  snapshot?: string;
}

export interface PipelineApi {
  /** one page of the filtered, sorted list (page 1 also carries stage counts) */
  fetchPage(q: PageQuery): Promise<PageResult>;
  /** every id + stage in a snapshot, for "select all" */
  fetchIds(snapshot: string): Promise<SnapshotIds>;
  /** rejects with NetworkError when the request fails */
  saveMoves(ops: MoveOp[], by: string): Promise<MoveResult[]>;
  /** teammates' changes, pushed by the server (a websocket in a real app) */
  subscribe(listener: (changes: RemoteChange[]) => void): () => void;
}

/** Endpoints, in one place. */
export const API = {
  deals: '/api/deals',
  ids: '/api/deals/ids',
  moves: '/api/deals/moves',
} as const;

/* ------------------------------------------------------- query strings */

export function filtersToParams(f: Filters, me: string): URLSearchParams {
  return new URLSearchParams({
    me,
    owner: f.owner,
    stage: f.stage,
    idle: String(f.idle),
    attention: f.attentionOnly ? '1' : '0',
    sort: f.sort,
    q: f.search,
  });
}

export function pageToParams(q: PageQuery): URLSearchParams {
  const p = filtersToParams(q.filters, q.me);
  p.set('page', String(q.page));
  p.set('limit', String(q.limit));
  if (q.snapshot) p.set('snapshot', q.snapshot);
  return p;
}

export function paramsToPage(p: URLSearchParams): PageQuery {
  const { filters, me } = paramsToFilters(p);
  return {
    filters,
    me,
    page: Number(p.get('page') ?? 1),
    limit: Number(p.get('limit') ?? 20),
    snapshot: p.get('snapshot') ?? undefined,
  };
}

export function paramsToFilters(p: URLSearchParams): { filters: Filters; me: string } {
  return {
    me: p.get('me') ?? '',
    filters: {
      preset: null,
      owner: p.get('owner') ?? 'all',
      stage: (p.get('stage') ?? 'all') as StageFilter,
      idle: Number(p.get('idle') ?? 0),
      attentionOnly: p.get('attention') === '1',
      sort: (p.get('sort') ?? 'value') as SortKey,
      search: p.get('q') ?? '',
    },
  };
}

/** The ids response can hold 50k entries; stages travel as one character each to keep it small. */
const CODE_TO_STAGE: Record<string, Stage> = {
  n: 'new',
  c: 'contacted',
  d: 'demo',
  p: 'proposal',
  g: 'negotiation',
  w: 'won',
  l: 'lost',
};
const STAGE_TO_CODE = Object.fromEntries(Object.entries(CODE_TO_STAGE).map(([k, v]) => [v, k])) as Record<
  Stage,
  string
>;

export interface IdsPayload {
  ids: string[];
  stages: string;
}

export const encodeIds = (v: SnapshotIds): IdsPayload => ({
  ids: v.ids,
  stages: v.stages.map((s) => STAGE_TO_CODE[s]).join(''),
});

export const decodeIds = (p: IdsPayload): SnapshotIds => ({
  ids: p.ids,
  stages: Array.from({ length: p.stages.length }, (_, i) => CODE_TO_STAGE[p.stages.charAt(i)]),
});

/* ----------------------------------------------------------- over HTTP */

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new NetworkError(`GET ${url.split('?')[0]} failed (${res.status})`);
  return (await res.json()) as T;
}

/** The app's API: real fetch() calls. In this project MSW answers them inside the browser. */
export class HttpApi implements PipelineApi {
  /** `baseUrl` is empty in the browser (same origin); tests pass an absolute one. */
  constructor(
    private readonly push: Pick<FakeServer, 'subscribe'>,
    private readonly baseUrl = '',
  ) {}

  fetchPage(q: PageQuery) {
    return getJson<PageResult>(`${this.baseUrl}${API.deals}?${pageToParams(q).toString()}`);
  }

  async fetchIds(snapshot: string) {
    const url = `${this.baseUrl}${API.ids}?snapshot=${encodeURIComponent(snapshot)}`;
    return decodeIds(await getJson<IdsPayload>(url));
  }

  async saveMoves(ops: MoveOp[], by: string) {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${API.moves}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ops, by }),
      });
    } catch {
      throw new NetworkError('Network error');
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new NetworkError(body.error ?? `Save failed (${res.status})`);
    }
    return (await res.json()) as MoveResult[];
  }

  // a real app would open a WebSocket here
  subscribe(listener: (changes: RemoteChange[]) => void) {
    return this.push.subscribe(listener);
  }
}

/* ------------------------------------------------------- same process */

/** Calls the fake server directly: used by tests, where there is no service worker. */
export class InProcessApi implements PipelineApi {
  constructor(private readonly server: FakeServer) {}

  fetchPage(q: PageQuery) {
    return Promise.resolve(this.server.queryPage(q.filters, q.me, q.page, q.limit, q.snapshot));
  }

  fetchIds(snapshot: string) {
    const ids = this.server.snapshotIds(snapshot);
    return ids ? Promise.resolve(ids) : Promise.reject(new NetworkError('Unknown snapshot'));
  }

  saveMoves(ops: MoveOp[], by: string) {
    return this.server.saveMoves(ops, by);
  }

  subscribe(listener: (changes: RemoteChange[]) => void) {
    return this.server.subscribe(listener);
  }
}
