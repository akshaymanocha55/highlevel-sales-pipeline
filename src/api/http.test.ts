import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, type Filters } from '../domain/filters';
import { CURRENT_USER, generateDeals } from '../domain/generate';
import { API, decodeIds, encodeIds, HttpApi, pageToParams, paramsToFilters, paramsToPage } from './client';
import { FakeServer, NetworkError } from './fakeServer';
import { createHandlers } from './mocks';

const BASE = 'http://localhost';
const fake = new FakeServer(generateDeals(1000, 5), {
  minLatency: 1,
  maxLatency: 2,
  failureRate: 0,
  teammateRate: 0,
  readLatency: 0,
});
const mswServer = setupServer(...createHandlers(fake));
const api = new HttpApi(fake, BASE);
const ALL: Filters = { ...DEFAULT_FILTERS, preset: null, owner: 'all', stage: 'all', attentionOnly: false };

beforeAll(() => mswServer.listen());
afterEach(() => {
  mswServer.resetHandlers();
  fake.setConfig({ offline: false, failureRate: 0 });
});
afterAll(() => mswServer.close());

describe('HTTP API (through MSW)', () => {
  it('GET /api/deals?page=1&limit=20 returns a page, the total, counts and a snapshot', async () => {
    const res = await api.fetchPage({ filters: { ...ALL, stage: 'won' }, me: CURRENT_USER, page: 1, limit: 20 });
    expect(res.items).toHaveLength(20);
    expect(res.items.every((d) => d.stage === 'won')).toBe(true);
    expect(res.total).toBe(fake.snapshotIds(res.snapshot)?.ids.length);
    expect(res.counts?.won.count).toBe(res.total);
    expect(res).toMatchObject({ page: 1, limit: 20 });
  });

  it('later pages continue the same snapshot, without counts', async () => {
    const p1 = await api.fetchPage({ filters: ALL, me: CURRENT_USER, page: 1, limit: 20 });
    const p2 = await api.fetchPage({ filters: ALL, me: CURRENT_USER, page: 2, limit: 20, snapshot: p1.snapshot });
    expect(p2.snapshot).toBe(p1.snapshot);
    expect(p2.counts).toBeUndefined();
    expect(p2.items[0].id).toBe(fake.snapshotIds(p1.snapshot)?.ids[20]);
    const past = await api.fetchPage({ filters: ALL, me: CURRENT_USER, page: 999, limit: 20, snapshot: p1.snapshot });
    expect(past.items).toEqual([]);
  });

  it('GET /api/deals/ids?snapshot= returns every id with its stage', async () => {
    const p1 = await api.fetchPage({ filters: ALL, me: CURRENT_USER, page: 1, limit: 20 });
    const all = await api.fetchIds(p1.snapshot);
    expect(all.ids).toHaveLength(p1.total);
    expect(all.stages[0]).toBe(p1.items[0].stage);
    await expect(api.fetchIds('no-such-snapshot')).rejects.toBeInstanceOf(NetworkError);
  });

  it('POST /api/deals/moves saves and returns per-deal results', async () => {
    const d = fake.getDeal('D-00010')!;
    const [r] = await api.saveMoves(
      [{ id: d.id, toStage: 'won', baseVersion: d.version, baseStage: d.stage }],
      CURRENT_USER,
    );
    expect(r.status).toBe('ok');
    expect(fake.getDeal('D-00010')?.stage).toBe('won');
  });

  it('a simulated failure comes back as HTTP 503 and a NetworkError', async () => {
    fake.setConfig({ offline: true });
    const d = fake.getDeal('D-00011')!;
    await expect(api.saveMoves([{ id: d.id, toStage: 'lost', baseStage: d.stage }], CURRENT_USER)).rejects.toThrow(
      new NetworkError('You are offline'),
    );
  });

  it('turns other HTTP errors and dropped connections into NetworkErrors', async () => {
    mswServer.use(
      http.get(`${BASE}${API.deals}`, () => new HttpResponse(null, { status: 500 })),
      http.post(`${BASE}${API.moves}`, () => HttpResponse.error()),
    );
    await expect(api.fetchPage({ filters: ALL, me: CURRENT_USER, page: 1, limit: 20 })).rejects.toBeInstanceOf(
      NetworkError,
    );
    await expect(api.saveMoves([], CURRENT_USER)).rejects.toThrow('Network error');

    mswServer.use(http.post(`${BASE}${API.moves}`, () => new HttpResponse('oops', { status: 502 })));
    await expect(api.saveMoves([], CURRENT_USER)).rejects.toThrow('Save failed (502)');
  });

  it('round-trips pages and filters through the query string, and ids through the payload', () => {
    const f: Filters = {
      ...ALL,
      owner: 'me',
      stage: 'open',
      idle: 30,
      attentionOnly: true,
      sort: 'idle',
      search: 'acme',
    };
    const q = { filters: f, me: 'Akshay Manocha', page: 3, limit: 20, snapshot: 's9' };
    expect(paramsToPage(pageToParams(q))).toEqual(q);
    expect(paramsToPage(pageToParams({ ...q, snapshot: undefined })).snapshot).toBeUndefined();
    expect(paramsToFilters(new URLSearchParams()).filters).toMatchObject({ owner: 'all', stage: 'all', sort: 'value' });
    const p1 = fake.queryPage(ALL, CURRENT_USER, 1, 20);
    const ids = fake.snapshotIds(p1.snapshot)!;
    expect(decodeIds(encodeIds(ids))).toEqual(ids);
  });

  it('passes teammate pushes straight through', () => {
    const seen: string[] = [];
    const off = api.subscribe((c) => seen.push(...c.map((x) => x.deal.id)));
    fake.teammateEditNow('D-00020', 'value');
    off();
    expect(seen).toEqual(['D-00020']);
  });
});
