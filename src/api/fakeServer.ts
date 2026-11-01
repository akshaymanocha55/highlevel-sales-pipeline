import { buildView, countByStage, type Filters, type StageCounts } from '../domain/filters';
import { mulberry32, OWNERS, CURRENT_USER } from '../domain/generate';
import {
  STAGES,
  STAGE_LABEL,
  type Deal,
  type MoveOp,
  type MoveResult,
  type RemoteChange,
  type Stage,
} from '../domain/types';

export interface ServerConfig {
  minLatency: number;
  maxLatency: number;
  /** 0..1 probability that a request fails with a network error */
  failureRate: number;
  /** teammate edits per second across the whole pipeline */
  teammateRate: number;
  /** every request fails */
  offline: boolean;
  /** the next save request will hit a conflict (a teammate moves the deal first) */
  forceConflictNext: boolean;
  /** delay for reads (list, pages, counts). Reads don't fail: the brief is about failed saves. */
  readLatency: number;
}

export const DEFAULT_CONFIG: ServerConfig = {
  minLatency: 300,
  maxLatency: 1500,
  failureRate: 0.1,
  teammateRate: 4,
  offline: false,
  forceConflictNext: false,
  readLatency: 150,
};

/** One page of a list. `snapshot` keeps later pages consistent with the first one. */
export interface PageResult {
  items: Deal[];
  total: number;
  page: number;
  limit: number;
  snapshot: string;
  /** stage counts, sent with page 1 only */
  counts?: StageCounts;
}

/** Every id in a snapshot with its stage, for "select all" and bulk moves. */
export interface SnapshotIds {
  ids: string[];
  stages: Stage[];
}

const MAX_SNAPSHOTS = 50;

export class NetworkError extends Error {
  constructor(msg = 'Network error') {
    super(msg);
    this.name = 'NetworkError';
  }
}

type Listener = (changes: RemoteChange[]) => void;

const TEAMMATES = OWNERS.filter((o) => o !== CURRENT_USER);
const copy = (d: Deal): Deal => ({ ...d });

/**
 * In-memory stand-in for the backend + websocket.
 * It owns its own copy of the data, so client and "server" can genuinely disagree.
 */
export class FakeServer {
  config: ServerConfig;
  private deals = new Map<string, Deal>();
  private ids: string[] = [];
  private listeners = new Set<Listener>();
  private snapshots = new Map<string, string[]>();
  private snapshotSeq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private carry = 0;
  private rand: () => number;
  /** stats for the dev panel */
  stats = { requests: 0, failed: 0, conflicts: 0, inFlight: 0, teammateEdits: 0 };

  constructor(initial: Deal[], config: Partial<ServerConfig> = {}, seed = 7) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rand = mulberry32(seed);
    for (const d of initial) {
      this.deals.set(d.id, copy(d));
      this.ids.push(d.id);
    }
  }

  setConfig(patch: Partial<ServerConfig>) {
    this.config = { ...this.config, ...patch };
  }

  /** Like opening a websocket: receive teammates' changes. */
  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  startTeammates() {
    if (this.timer) return;
    const TICK = 100;
    this.timer = setInterval(() => {
      this.carry += (this.config.teammateRate * TICK) / 1000;
      const n = Math.floor(this.carry);
      if (n <= 0) return;
      this.carry -= n;
      const changes: RemoteChange[] = [];
      for (let i = 0; i < n; i++) {
        const id = this.ids[Math.floor(this.rand() * this.ids.length)];
        const c = this.teammateEdit(id);
        if (c) changes.push(c);
      }
      this.emit(changes);
    }, TICK);
  }

  stopTeammates() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Dev-panel helper: a teammate edits this exact deal right now. */
  teammateEditNow(id: string, kind?: 'stage' | 'value' | 'owner') {
    const c = this.teammateEdit(id, kind);
    if (c) this.emit([c]);
  }

  /* ------------------------------------------------------------- reads */

  /**
   * GET /api/deals?page=&limit=&…filters: one page of the filtered, sorted list.
   *
   * The first request (no snapshot) sorts the list and remembers that order as a snapshot.
   * Later pages read from the same snapshot, so a teammate moving a deal can't shift rows
   * between pages (no duplicates, no gaps). Each row's details are always current.
   * An unknown or expired snapshot simply starts a new one; the client notices and reloads.
   */
  queryPage(
    filters: Filters,
    me: string,
    page: number,
    limit: number,
    snapshot?: string,
    now = Date.now(),
  ): PageResult {
    let key = snapshot;
    let ids = key ? this.snapshots.get(key) : undefined;
    const fresh = !ids;
    if (!ids) {
      ids = buildView(this.deals.values(), filters, me, now);
      key = `s${++this.snapshotSeq}`;
      this.snapshots.set(key, ids);
      if (this.snapshots.size > MAX_SNAPSHOTS) {
        const oldest = this.snapshots.keys().next().value;
        if (oldest) this.snapshots.delete(oldest);
      }
    }
    const p = Math.max(1, Math.floor(page));
    const n = Math.max(1, Math.min(500, Math.floor(limit)));
    const items: Deal[] = [];
    for (const id of ids.slice((p - 1) * n, p * n)) {
      const d = this.deals.get(id);
      if (d) items.push(copy(d));
    }
    return {
      items,
      total: ids.length,
      page: p,
      limit: n,
      snapshot: key ?? '',
      counts: p === 1 || fresh ? countByStage(this.deals.values(), filters, me, now) : undefined,
    };
  }

  /** GET /api/deals/ids?snapshot=: every id in a snapshot with its current stage. */
  snapshotIds(snapshot: string): SnapshotIds | undefined {
    const ids = this.snapshots.get(snapshot);
    if (!ids) return undefined;
    return { ids, stages: ids.map((id) => this.deals.get(id)?.stage ?? 'new') };
  }

  readDelay() {
    return this.config.readLatency;
  }

  /** Save one or many stage moves in a single request. */
  async saveMoves(ops: MoveOp[], by: string): Promise<MoveResult[]> {
    this.stats.requests++;
    this.stats.inFlight++;
    try {
      const { minLatency, maxLatency } = this.config;
      const lo = Math.min(minLatency, maxLatency);
      const hi = Math.max(minLatency, maxLatency);
      await sleep(lo + this.rand() * (hi - lo));

      if (this.config.offline || this.rand() < this.config.failureRate) {
        this.stats.failed++;
        throw new NetworkError(this.config.offline ? 'You are offline' : 'Request failed (timeout)');
      }

      if (this.config.forceConflictNext && ops.length) {
        this.config = { ...this.config, forceConflictNext: false };
        const target = ops[0];
        const others = STAGES.filter((s) => s !== target.toStage && s !== target.baseStage);
        this.teammateEdit(target.id, 'stage', others[Math.floor(this.rand() * others.length)], true);
      }

      const now = Date.now();
      return ops.map((op): MoveResult => {
        const d = this.deals.get(op.id);
        if (!d) return { id: op.id, status: 'not_found' };
        // Field-aware conflict check: only a *stage* change by someone else since the client's
        // base version is a conflict. A teammate editing the value is merged silently.
        // (rows never loaded on screen have no version yet, only the stage the user saw)
        const versionMoved = op.baseVersion === undefined || d.version !== op.baseVersion;
        const stageChangedByOther = versionMoved && d.stage !== op.baseStage && d.updatedBy !== by;
        if (stageChangedByOther && !op.force) {
          this.stats.conflicts++;
          return { id: op.id, status: 'conflict', deal: copy(d) };
        }
        d.stage = op.toStage;
        d.version++;
        d.updatedBy = by;
        d.updatedAt = now;
        d.lastActivityAt = now;
        return { id: op.id, status: 'ok', deal: copy(d) };
      });
    } finally {
      this.stats.inFlight--;
    }
  }

  getDeal(id: string) {
    const d = this.deals.get(id);
    return d ? copy(d) : undefined;
  }

  private emit(changes: RemoteChange[]) {
    if (!changes.length) return;
    for (const l of this.listeners) l(changes);
  }

  /** Mutates a deal as some teammate. `silent` = apply but caller decides whether to emit. */
  private teammateEdit(
    id: string,
    kind?: 'stage' | 'value' | 'owner',
    toStage?: Stage,
    emitNow = false,
  ): RemoteChange | null {
    const d = this.deals.get(id);
    if (!d) return null;
    const who = TEAMMATES[Math.floor(this.rand() * TEAMMATES.length)];
    const r = this.rand();
    const k = kind ?? (r < 0.6 ? 'stage' : r < 0.85 ? 'value' : 'owner');
    let summary: string;
    if (k === 'stage') {
      let next = toStage;
      if (!next) {
        const i = STAGES.indexOf(d.stage);
        // teammates mostly push deals forward; sometimes they lose them
        next =
          d.stage === 'won' || d.stage === 'lost'
            ? 'negotiation'
            : this.rand() < 0.15
              ? 'lost'
              : STAGES[Math.min(i + 1, STAGES.length - 1)];
      }
      if (next === d.stage) return null;
      summary = `${who} moved it to ${STAGE_LABEL[next]}`;
      d.stage = next;
    } else if (k === 'value') {
      const factor = 0.8 + this.rand() * 0.5;
      d.licences = Math.max(1, Math.round(d.licences * factor));
      d.value = Math.round((d.value * factor) / 1000) * 1000;
      summary = `${who} updated the value`;
    } else {
      const newOwner = OWNERS[Math.floor(this.rand() * OWNERS.length)];
      if (newOwner === d.owner) return null;
      summary = `${who} reassigned it to ${newOwner}`;
      d.owner = newOwner;
    }
    d.version++;
    d.updatedBy = who;
    d.updatedAt = Date.now();
    d.lastActivityAt = d.updatedAt;
    this.stats.teammateEdits++;
    const change = { deal: copy(d), summary };
    if (emitNow) this.emit([change]);
    return change;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
