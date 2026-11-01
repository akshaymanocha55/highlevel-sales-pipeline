import { describe, expect, it, vi } from 'vitest';
import { firstIn, loaded, makeStore, refresh, settle, tick, view } from '../test/helpers';
import { Emitter } from './emitter';
import type { PageResult } from '../api/fakeServer';
import { BATCH_SIZE, MAX_ATTEMPTS } from './pipelineStore';

describe('optimistic moves', () => {
  it('shows the new stage immediately and confirms it later', async () => {
    const { store, api } = await makeStore();
    const id = firstIn(store, 'new');
    store.move([id], 'contacted');

    expect(store.getDeal(id)?.stage).toBe('contacted');
    expect(api.getDeal(id)?.stage).toBe('new');
    expect(store.getPending(id)?.status).toBe('saving');
    expect(store.syncSummary()).toEqual({ saving: 1, failed: 0, conflicts: 0 });

    await settle(store);
    expect(api.getDeal(id)?.stage).toBe('contacted');
    expect(store.getPending(id)).toBeUndefined();
    expect(store.savedAt.has(id)).toBe(true);
  });

  it('ignores moves to the stage a deal is already in', async () => {
    const { store } = await makeStore();
    const id = firstIn(store, 'demo');
    expect(store.move([id], 'demo')).toBeNull();
    expect(store.move(['does-not-exist'], 'won')).toBeNull();
    expect(store.pending.size).toBe(0);
  });

  it('describes single and bulk moves', async () => {
    const { store } = await makeStore();
    const [a, b, c] = store.viewIds.filter((id) => store.getDeal(id)?.stage === 'new');
    const one = store.move([a], 'lost');
    expect(one?.label).toBe(`Moved ${store.getDeal(a)?.company} to Lost`);
    const two = store.move([b, c], 'won');
    expect(two?.label).toBe('Moved 2 deals to Won');
  });

  it('never lets an older response overwrite a newer move of the same deal', async () => {
    const { store, api } = await makeStore(200, { minLatency: 20, maxLatency: 60 });
    const id = firstIn(store, 'new');
    store.move([id], 'contacted');
    await tick(1);
    store.move([id], 'demo');
    store.move([id], 'proposal');
    await settle(store);
    expect(api.getDeal(id)?.stage).toBe('proposal');
    expect(store.getDeal(id)?.stage).toBe('proposal');
  });

  it('moving back to the saved stage before sending cancels the save', async () => {
    const { store, api } = await makeStore();
    const id = firstIn(store, 'new');
    store.move([id], 'won');
    store.move([id], 'new');
    expect(store.getPending(id)).toBeUndefined();
    await tick(20);
    expect(api.stats.requests).toBe(0);
  });

  it('steps deals one stage forward or back, skipping deals at the end', async () => {
    const { store } = await makeStore();
    const n = firstIn(store, 'negotiation');
    const w = firstIn(store, 'won');
    const l = firstIn(store, 'lost');
    store.step([n, w], 1);
    expect(store.getDeal(n)?.stage).toBe('won');
    expect(store.getDeal(w)?.stage).toBe('won'); // already terminal
    store.step([l], -1);
    expect(store.getDeal(l)?.stage).toBe('negotiation');
    store.step(['missing'], 1);
    await settle(store);
  });
});

describe('failed saves', () => {
  it('retries quietly with backoff, then rolls back and keeps the failure visible', async () => {
    const { store, api } = await makeStore(200, { failureRate: 1 });
    const id = firstIn(store, 'new');
    const statuses: (string | undefined)[] = [];
    store.subscribeRow(id, () => statuses.push(store.getPending(id)?.status));
    store.move([id], 'won');
    await settle(store);
    expect(statuses).toContain('retrying');

    const p = store.getPending(id);
    expect(p).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, error: 'Request failed (timeout)' });
    expect(api.stats.requests).toBe(MAX_ATTEMPTS);
    expect(store.getDeal(id)?.stage).toBe('new'); // the screen rolled back on its own
    expect(store.syncSummary().failed).toBe(1);
    expect(store.announcement.text).toMatch(/1 save failed/);

    api.setConfig({ failureRate: 0 });
    store.retry([id]);
    expect(store.getDeal(id)?.stage).toBe('won');
    await settle(store);
    expect(store.getPending(id)).toBeUndefined();
    expect(api.getDeal(id)?.stage).toBe('won');
  });

  it('retry and discard ignore deals that have nothing to resolve', async () => {
    const { store } = await makeStore();
    const jobsBefore = store.jobs.length;
    store.retry([store.viewIds[0]]);
    store.discard([store.viewIds[0]]);
    expect(store.jobs.length).toBe(jobsBefore);
  });

  it('discard drops my change and keeps the server version', async () => {
    const { store, api } = await makeStore(200, { offline: true });
    const id = firstIn(store, 'new');
    store.move([id], 'lost');
    await settle(store);
    expect(store.getPending(id)?.error).toBe('You are offline');
    store.discard([id]);
    expect(store.getPending(id)).toBeUndefined();
    expect(store.getDeal(id)?.stage).toBe('new');
    expect(api.getDeal(id)?.stage).toBe('new');
    expect(store.announcement.text).toBe('Discarded 1 change');
  });

  it('a newer move during a failing request is sent instead of being retried', async () => {
    const { store, api } = await makeStore(200, { failureRate: 1, minLatency: 20, maxLatency: 20 });
    const id = firstIn(store, 'new');
    store.move([id], 'contacted');
    await tick(5); // first request is on the wire
    api.setConfig({ failureRate: 0 });
    store.move([id], 'demo');
    await settle(store);
    expect(api.getDeal(id)?.stage).toBe('demo');
  });

  it('a failed deal that was filtered out is counted as a pending change to the view', async () => {
    const { store } = await makeStore(300, { offline: true });
    await view(store, { stage: 'new' });
    const id = store.viewIds[0];
    store.move([id], 'won'); // leaves the New Lead view
    expect(store.viewIds).not.toContain(id);
    await settle(store);
    expect(store.stale.has(id)).toBe(true); // it's back in New Lead on the server
  });
});

describe('conflicts with teammates', () => {
  it('detects a teammate stage change and lets the user keep mine', async () => {
    const { store, api } = await makeStore(200, { forceConflictNext: true });
    const id = firstIn(store, 'new');
    store.move([id], 'contacted');
    await settle(store);

    const p = store.getPending(id);
    expect(p?.status).toBe('conflict');
    expect(p?.theirs?.stage).toBe(api.getDeal(id)?.stage);
    expect(store.syncSummary().conflicts).toBe(1);
    expect(store.announcement.text).toMatch(/^Conflict on/);

    store.keepMine([id]);
    expect(store.getPending(id)?.force).toBe(true);
    await settle(store);
    expect(api.getDeal(id)?.stage).toBe('contacted');
  });

  it('keep theirs accepts the teammate version', async () => {
    const { store, api } = await makeStore(200, { forceConflictNext: true });
    const id = firstIn(store, 'new');
    store.move([id], 'contacted');
    await settle(store);
    store.discard([id]);
    expect(store.getDeal(id)?.stage).toBe(api.getDeal(id)?.stage);
  });

  it('a teammate editing only the value is merged, not a conflict', async () => {
    const { store, api } = await makeStore(200, { minLatency: 30, maxLatency: 30 });
    const id = firstIn(store, 'new');
    store.move([id], 'demo');
    api.teammateEditNow(id, 'value');
    await settle(store);
    expect(store.getPending(id)).toBeUndefined();
    expect(api.getDeal(id)?.stage).toBe('demo');
  });

  it('while my save is in flight, the row keeps showing my choice', async () => {
    const { store, api } = await makeStore(200, { minLatency: 50, maxLatency: 50 });
    const id = firstIn(store, 'new');
    store.move([id], 'demo');
    api.teammateEditNow(id, 'value');
    expect(store.getDeal(id)?.stage).toBe('demo');
  });
});

describe('live updates do not disturb the user', () => {
  it('teammate changes update rows in place but never reorder the list until refresh', async () => {
    const { store, api } = await makeStore();
    await view(store, { stage: 'new' });
    const before = [...store.viewIds];
    const id = before[3];
    const rowVersion = store.getRowVersion(id);
    api.teammateEditNow(id, 'stage');

    expect(store.viewIds).toEqual(before);
    expect(store.getDeal(id)?.stage).not.toBe('new');
    expect(store.getRowVersion(id)).toBe(rowVersion + 1);
    expect(store.stale.has(id)).toBe(true);
    expect(store.remoteFlash.get(id)?.summary).toMatch(/moved it to/);

    await refresh(store);
    expect(store.viewIds).not.toContain(id);
    expect(store.stale.size).toBe(0);
  });

  it('counts a change that would re-sort the list as pending', async () => {
    const { store, api } = await makeStore();
    await view(store, { sort: 'value' });
    const id = store.viewIds[10];
    api.teammateEditNow(id, 'value');
    expect(store.stale.has(id)).toBe(true);
  });

  it('a teammate change outside the view does not count', async () => {
    const { store, api } = await makeStore();
    await view(store, { stage: 'won' });
    const outside = firstIn((await makeStore()).store, 'new');
    api.teammateEditNow(outside, 'value');
    expect(store.stale.size).toBe(0);
  });

  it('keeps the focused deal under the cursor after a refresh', async () => {
    const { store, api } = await makeStore();
    await view(store, { stage: 'new' });
    store.setFocus(10);
    const focused = store.focusId;
    api.teammateEditNow(store.viewIds[2], 'stage');
    await refresh(store);
    expect(store.focusId).toBe(focused);
  });

  it('drops selected deals that left the view on refresh', async () => {
    const { store, api } = await makeStore();
    await view(store, { stage: 'new' });
    const [a, b] = store.viewIds;
    store.toggleSelect(a);
    store.toggleSelect(b);
    api.teammateEditNow(a, 'stage');
    await refresh(store);
    expect([...store.selected]).toEqual([b]);
  });

  it('ignores duplicate or out-of-order events', async () => {
    const { store, api } = await makeStore();
    const id = store.viewIds[0];
    api.teammateEditNow(id, 'value');
    const latest = store.getServerDeal(id)!;
    const listener = vi.fn();
    store.subscribeRow(id, listener);
    // replay an older version
    (store as unknown as { applyRemote: (c: unknown[]) => void }).applyRemote([
      { deal: { ...latest, version: latest.version - 1, value: 1 }, summary: 'old' },
    ]);
    expect(store.getServerDeal(id)?.value).toBe(latest.value);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('view, filters and counts', () => {
  it('my own move removes the row from a view it no longer fits, keeping the cursor in place', async () => {
    const { store } = await makeStore();
    await view(store, { stage: 'new' });
    store.setFocus(2);
    const next = store.viewIds[3];
    store.move([store.viewIds[2]], 'contacted');
    expect(store.focusId).toBe(next);
  });

  it('a move that still fits the view keeps the row and the focus', async () => {
    const { store } = await makeStore();
    await view(store, { stage: 'open' });
    store.setFocus(1);
    const id = store.focusId!;
    store.step([id], 1);
    expect(store.focusId).toBe(id);
  });

  it('changing filters resets selection and focus and leaves the preset', async () => {
    const { store } = await makeStore();
    store.applyPreset('team');
    await loaded(store);
    expect(store.filters.preset).toBe('team');
    store.toggleSelect(store.viewIds[0]);
    store.setFocus(5);
    await view(store, { search: '  ACME ' });
    expect(store.filters).toMatchObject({ preset: null, search: 'acme' });
    expect(store.selected.size).toBe(0);
    expect(store.focusIndex).toBe(0);
    expect(store.viewIds.every((id) => store.getDeal(id)?.companyLc.includes('acme'))).toBe(true);
  });

  it('matches search on owner names too', async () => {
    const { store } = await makeStore(2000);
    await view(store, { search: 'rahul' });
    expect(store.viewIds.length).toBeGreaterThan(0);
    expect(store.viewIds.every((id) => store.getDeal(id)?.owner === 'Rahul Verma')).toBe(true);
  });

  it('keeps stage counts up to date after moves (batched per frame)', async () => {
    const { store } = await makeStore();
    await tick(30); // counts are recomputed once per frame
    const wonBefore = store.counts.won.count;
    store.move([firstIn(store, 'new')], 'won');
    await vi.waitFor(() => expect(store.counts.won.count).toBe(wonBefore + 1));
    const total = Object.entries(store.counts)
      .filter(([k]) => k !== 'all' && k !== 'open')
      .reduce((s, [, v]) => s + v.count, 0);
    expect(total).toBe(store.counts.all.count);
  });

  it('applies every preset', async () => {
    const { store } = await makeStore(2000);
    store.applyPreset('focus');
    await loaded(store);
    expect(store.viewIds.every((id) => store.getDeal(id)?.owner === store.me)).toBe(true);
    store.applyPreset('cleanup');
    await loaded(store);
    expect(store.filters.idle).toBe(90);
  });
});

describe('focus and selection', () => {
  it('clamps focus to the list', async () => {
    const { store } = await makeStore(50);
    store.setFocus(-5);
    expect(store.focusIndex).toBe(0);
    store.setFocus(10_000);
    expect(store.focusIndex).toBe(store.viewIds.length - 1);
  });

  it('toggles, ranges, selects all and clears', async () => {
    const { store } = await makeStore(50);
    const ids = store.viewIds;
    store.toggleSelect(ids[2], 2);
    store.selectRange(5);
    expect([...store.selected].sort()).toEqual(ids.slice(2, 6).sort());
    store.selectRange(0); // range from the same anchor, upwards
    expect(store.selected.has(ids[0])).toBe(true);
    store.toggleSelect(ids[2]);
    expect(store.selected.has(ids[2])).toBe(false);
    store.selectAll();
    expect(store.selected.size).toBe(ids.length);
    expect(store.announcement.text).toBe(`${ids.length} deals selected`);
    store.clearSelection();
    expect(store.selected.size).toBe(0);
  });

  it('acts on the selection, or on the focused row when nothing is selected', async () => {
    const { store } = await makeStore(50);
    store.setFocus(3);
    expect(store.targetIds()).toEqual([store.viewIds[3]]);
    store.toggleSelect(store.viewIds[7]);
    expect(store.targetIds()).toEqual([store.viewIds[7]]);
  });

  it('clears the selection after a move', async () => {
    const { store } = await makeStore(50);
    store.toggleSelect(store.viewIds[0]);
    store.move(store.targetIds(), 'lost');
    expect(store.selected.size).toBe(0);
  });

  it('has no targets in an empty view', async () => {
    const { store } = await makeStore(50);
    await view(store, { search: 'zzzz-no-match' });
    expect(store.targetIds()).toEqual([]);
    expect(store.focusId).toBeUndefined();
  });
});

describe('bulk moves and undo', () => {
  it('sends thousands of moves in batches and can undo them', async () => {
    const { store, api } = await makeStore(6000);
    await view(store, { stage: 'open' });
    const ids = store.viewIds.slice(0, 3000);
    const prev = new Map(ids.map((id) => [id, store.getDeal(id)?.stage]));
    const job = store.move(ids, 'lost')!;
    expect(store.jobProgress(job)).toMatchObject({ total: 3000, saving: 3000, done: 0 });

    await settle(store);
    expect(api.stats.requests).toBe(Math.ceil(3000 / BATCH_SIZE));
    expect(store.jobProgress(job)).toEqual({ total: 3000, saving: 0, failed: 0, conflicts: 0, done: 3000 });
    expect(ids.every((id) => api.getDeal(id)?.stage === 'lost')).toBe(true);

    store.undo(job.id);
    expect(job.undone).toBe(true);
    await settle(store);
    expect(ids.every((id) => api.getDeal(id)?.stage === prev.get(id))).toBe(true);
    store.undo(job.id); // second undo is a no-op
    expect(store.jobs[0].kind).toBe('undo');
  });

  it('reports partial failure per deal, not all-or-nothing', async () => {
    const { store } = await makeStore(3000, { failureRate: 0.5 });
    await view(store, { stage: 'open' });
    const job = store.move(store.viewIds.slice(0, 2000), 'lost')!;
    await settle(store, 15_000);
    const p = store.jobProgress(job);
    expect(p.saving).toBe(0);
    expect(p.done + p.failed).toBe(2000);
  });

  it('counts conflicts apart from failures, so the user is asked to choose, not to retry', async () => {
    const { api, store } = await makeStore(200);
    const a = firstIn(store, 'new');
    api.setConfig({ forceConflictNext: true });
    const job = store.move([a], 'won')!;
    await settle(store);
    expect(store.jobProgress(job)).toEqual({ total: 1, saving: 0, failed: 0, conflicts: 1, done: 0 });
  });

  it('undo without an id undoes the latest move; failed deals are just dropped', async () => {
    const { store } = await makeStore(200, { offline: true });
    const a = firstIn(store, 'new');
    store.move([a], 'won');
    await settle(store);
    store.undo();
    expect(store.getPending(a)).toBeUndefined();
    expect(store.getDeal(a)?.stage).toBe('new');
  });

  it('undo leaves deals alone that a later action moved on', async () => {
    const { store, api } = await makeStore();
    const id = firstIn(store, 'new');
    const first = store.move([id], 'contacted')!;
    store.move([id], 'demo');
    await settle(store);
    store.undo(first.id);
    await settle(store);
    expect(api.getDeal(id)?.stage).toBe('demo');
  });

  it('keeps the last 20 jobs and can dismiss them', async () => {
    const { store } = await makeStore();
    for (let i = 0; i < 25; i++) store.move([store.viewIds[i]], 'lost');
    expect(store.jobs).toHaveLength(20);
    store.dismissJob(store.jobs[0].id);
    expect(store.jobs[0].dismissed).toBe(true);
    store.dismissJob(-1);
  });
});

describe('lifecycle', () => {
  it('stops talking to the server after dispose', async () => {
    const { store, api } = await makeStore(200, { failureRate: 1 });
    store.move([firstIn(store, 'new')], 'won');
    await tick(15);
    store.dispose();
    const requests = api.stats.requests;
    await tick(50);
    expect(api.stats.requests).toBe(requests);
    api.teammateEditNow(store.viewIds[0], 'value'); // no longer subscribed
    expect(store.remoteFlash.size).toBe(0);
  });

  it('uses the injected clock and user', async () => {
    const { store } = await makeStore(100, {}, { clock: () => 42, me: 'Rahul Verma' });
    expect(store.now()).toBe(42);
    await view(store, { owner: 'me' });
    expect(store.viewIds.every((id) => store.getDeal(id)?.owner === 'Rahul Verma')).toBe(true);
  });
});

describe('Emitter', () => {
  it('notifies topic and row subscribers and tracks versions', () => {
    const e = new Emitter<'a' | 'b'>();
    const onA = vi.fn();
    const onRow = vi.fn();
    const offA = e.subscribe('a', onA);
    const offRow = e.subscribeRow('x', onRow);
    e.emit('a');
    e.emit('b');
    e.emitRow('x');
    e.emitRow('y');
    expect(onA).toHaveBeenCalledTimes(1);
    expect(onRow).toHaveBeenCalledTimes(1);
    expect([e.version('a'), e.version('b'), e.rowVersion('x'), e.rowVersion('zz')]).toEqual([1, 1, 1, 0]);
    offA();
    offRow();
    e.emit('a');
    e.emitRow('x');
    expect(onA).toHaveBeenCalledTimes(1);
    expect(onRow).toHaveBeenCalledTimes(1);
  });

  it('collapses batched emits into one per frame and runs the pre-emit hook', async () => {
    const before = vi.fn();
    const e = new Emitter<'meta'>(before);
    const fn = vi.fn();
    e.subscribe('meta', fn);
    e.emitBatched('meta');
    e.emitBatched('meta');
    e.emitBatched('meta');
    expect(fn).not.toHaveBeenCalled();
    await tick(30);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(before).toHaveBeenCalledTimes(1);
  });
});

describe('infinite scroll: page=N&limit=20 against a snapshot', () => {
  async function fresh(count = 2000) {
    const { generateDeals } = await import('../domain/generate');
    const { FakeServer } = await import('../api/fakeServer');
    const { InProcessApi } = await import('../api/client');
    const { PipelineStore } = await import('./pipelineStore');
    const server = new FakeServer(generateDeals(count, 1), {
      minLatency: 2,
      maxLatency: 4,
      failureRate: 0,
      teammateRate: 0,
    });
    const api = new InProcessApi(server);
    const spy = { page: vi.spyOn(api, 'fetchPage'), ids: vi.spyOn(api, 'fetchIds') };
    // "Nobody" owns nothing, so the default "my deals" list is empty
    const store = new PipelineStore(api, { me: 'Nobody' });
    await store.whenLoaded();
    store.setFilters({ owner: 'all', stage: 'all', attentionOnly: false, sort: 'value' });
    await store.whenLoaded();
    spy.page.mockClear();
    spy.ids.mockClear();
    store.setFilters({ sort: 'company' }); // the list under test
    await store.whenLoaded();
    return { store, server, spy };
  }

  it('asks for page 1, which brings the total, the counts and a snapshot', async () => {
    const { store, spy } = await fresh();
    const first = spy.page.mock.calls[0][0];
    expect(first).toMatchObject({ page: 1, limit: 20 });
    expect(first.snapshot).toBeUndefined();
    expect(store.size).toBe(2000); // the scrollbar knows the full length
    expect(store.counts.all.count).toBe(2000);
    expect(store.viewIds[0]).not.toBe('');
    expect(store.viewIds[25]).toBe(''); // page 2 not loaded: a placeholder
    expect(store.getDeal(store.viewIds[25])).toBeUndefined();
  });

  it('loads each page once as rows scroll into view, against the same snapshot', async () => {
    const { store, spy } = await fresh();
    const firstPage = (await spy.page.mock.results[0].value) as PageResult;
    const snapshot = firstPage.snapshot;
    store.loadRange(25, 45); // pages 2 and 3
    store.loadRange(30, 50); // same pages again: no new requests
    await store.whenLoaded();
    const later = spy.page.mock.calls.slice(1).map(([q]) => q);
    expect(later.map((q) => q.page)).toEqual([2, 3]);
    expect(later.every((q) => q.snapshot === snapshot && q.limit === 20)).toBe(true);
    expect(store.viewIds.slice(20, 60).every(Boolean)).toBe(true);
    expect(store.viewIds[60]).toBe('');
  });

  it('jumps straight to the last page', async () => {
    const { store, spy } = await fresh();
    store.loadRange(1990, 1999);
    await store.whenLoaded();
    expect(spy.page.mock.calls.at(-1)?.[0].page).toBe(100);
    expect(store.getDeal(store.viewIds[1999])).toBeDefined();
  });

  it('keeps pages consistent while teammates move deals (no duplicates, no gaps)', async () => {
    const { store, server } = await fresh();
    const page2Before = server.queryPage(store.filters, store.me, 2, 20).items.map((d) => d.id);
    // a teammate renames nothing but moves deals around; the order snapshot doesn't change
    for (const id of page2Before.slice(0, 5)) server.teammateEditNow(id, 'value');
    store.loadRange(0, 1999);
    await store.whenLoaded();
    const ids = store.viewIds;
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(Boolean)).toBe(true);
  });

  it('retries a page that failed to load on the next scroll', async () => {
    const { store, spy } = await fresh();
    spy.page.mockRejectedValueOnce(new Error('offline'));
    store.loadRange(20, 39);
    await store.whenLoaded();
    expect(store.viewIds[20]).toBe('');
    store.loadRange(20, 39);
    await store.whenLoaded();
    expect(store.viewIds[20]).not.toBe('');
  });

  it('starts over if the server no longer knows the snapshot', async () => {
    const { store, spy, server } = await fresh();
    spy.page.mockImplementationOnce((q) =>
      Promise.resolve(server.queryPage(q.filters, q.me, q.page, q.limit, 'expired')),
    );
    store.loadRange(40, 59);
    await store.whenLoaded();
    await store.whenLoaded();
    const reloads = spy.page.mock.calls.slice(2).filter(([q]) => q.page === 1 && !q.snapshot);
    expect(reloads).toHaveLength(1); // started the list again from the top
    expect(store.viewIds[0]).not.toBe('');
  });

  it('ignores an older list that arrives after a newer one', async () => {
    const { store, spy, server } = await fresh();
    let releaseOld: () => void = () => undefined;
    spy.page.mockImplementationOnce(
      (q) =>
        new Promise((resolve) => {
          releaseOld = () => {
            resolve(server.queryPage(q.filters, q.me, q.page, q.limit));
          };
        }),
    );
    store.setFilters({ stage: 'won' }); // slow
    store.setFilters({ stage: 'lost' }); // fast
    await store.whenLoaded();
    releaseOld();
    await tick(5);
    expect(store.viewIds.filter(Boolean).every((id) => store.stageOf(id) === 'lost')).toBe(true);
  });

  it('shows an error when the list cannot load, and recovers on retry', async () => {
    const { store, spy } = await fresh();
    spy.page.mockRejectedValueOnce(new Error('Server unavailable'));
    store.setFilters({ stage: 'won' });
    await store.whenLoaded();
    expect(store.viewError).toBe('Server unavailable');
    expect(store.viewLoading).toBe(false);
    store.refreshView();
    await store.whenLoaded();
    expect(store.viewError).toBeNull();
    expect(store.size).toBeGreaterThan(0);
  });

  it('"select all" fetches the ids once, then bulk-moves rows that were never loaded', async () => {
    const { store, server, spy } = await fresh();
    store.selectAll();
    await store.whenLoaded();
    expect(spy.ids).toHaveBeenCalledOnce();
    expect(store.selected.size).toBe(2000);
    const unloaded = store.viewIds.filter((id) => !store.isLoaded(id));
    expect(unloaded.length).toBeGreaterThan(1500);
    store.move(unloaded, 'lost');
    await settle(store);
    expect(unloaded.every((id) => server.getDeal(id)?.stage === 'lost')).toBe(true);
    store.selectAll(); // everything known now: no second request
    expect(spy.ids).toHaveBeenCalledOnce();
  });

  it('still detects a conflict on a row that was never loaded', async () => {
    const { store, server } = await fresh();
    store.selectAll();
    await store.whenLoaded();
    store.clearSelection();
    const id = store.viewIds.slice(100).find((i) => store.stageOf(i) === 'new')!;
    server.teammateEditNow(id, 'stage'); // the push updates our copy…
    // …but pretend the user acted on the stage they saw before it arrived
    (store as unknown as { stageHint: Map<string, string> }).stageHint.set(id, 'new');
    (store as unknown as { deals: Map<string, unknown> }).deals.delete(id);
    store.move([id], 'won');
    await settle(store);
    expect(store.getPending(id)?.status).toBe('conflict');
  });

  it('keeps stage counts current from save results and pushes, with no extra requests', async () => {
    const { store, server, spy } = await fresh();
    spy.page.mockClear();
    const id = store.viewIds.find((i) => i && store.stageOf(i) !== 'lost' && store.stageOf(i) !== 'won')!;
    const from = store.stageOf(id)!;
    const before = { ...store.counts };
    store.move([id], 'lost');
    await settle(store);
    expect(store.counts.lost.count).toBe(before.lost.count + 1);
    expect(store.counts[from].count).toBe(before[from].count - 1);
    expect(store.counts.open.count).toBe(before.open.count - 1);

    const other = store.viewIds.find((i) => i && store.stageOf(i) === 'new')!;
    server.teammateEditNow(other, 'stage');
    expect(store.counts.new.count).toBe(before.new.count - 1);
    expect(spy.page).not.toHaveBeenCalled();
  });
});
