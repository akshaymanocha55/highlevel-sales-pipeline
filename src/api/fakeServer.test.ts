import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_USER, generateDeals } from '../domain/generate';
import type { MoveOp, RemoteChange } from '../domain/types';
import { DEFAULT_CONFIG, FakeServer, NetworkError } from './fakeServer';

const deals = generateDeals(200, 3);
const quiet = { minLatency: 300, maxLatency: 300, failureRate: 0, teammateRate: 0 };

function opFor(server: FakeServer, id: string, toStage: MoveOp['toStage']): MoveOp {
  const d = server.getDeal(id)!;
  return { id, toStage, baseVersion: d.version, baseStage: d.stage };
}

/** run a save to completion under fake timers */
async function save(server: FakeServer, ops: MoveOp[], by = CURRENT_USER) {
  // attach handlers before advancing time, so a rejection is never "unhandled"
  const result = server.saveMoves(ops, by).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await vi.advanceTimersByTimeAsync(10_000);
  const r = await result;
  if (!r.ok) throw r.error;
  return r.value;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('FakeServer', () => {
  it('uses the brief defaults: 300–1500 ms latency and 10% failures', () => {
    expect(DEFAULT_CONFIG).toMatchObject({ minLatency: 300, maxLatency: 1500, failureRate: 0.1 });
  });

  it('keeps its own copy of the data', () => {
    const local = generateDeals(5, 3);
    const server = new FakeServer(local, quiet);
    local[0].stage = 'won';
    expect(server.getDeal(local[0].id)?.stage).toBe(deals[0].stage);
    expect(server.getDeal('nope')).toBeUndefined();
  });

  it('applies a move after the configured delay and bumps the version', async () => {
    const server = new FakeServer(deals, quiet);
    const id = deals[0].id;
    let done = false;
    const p = server.saveMoves([opFor(server, id, 'won')], CURRENT_USER).then((r) => ((done = true), r));
    await vi.advanceTimersByTimeAsync(299);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const [r] = await p;
    expect(r.status).toBe('ok');
    expect(server.getDeal(id)).toMatchObject({ stage: 'won', version: 2, updatedBy: CURRENT_USER });
  });

  it('fails requests at the configured rate, and always when offline', async () => {
    const failing = new FakeServer(deals, { ...quiet, failureRate: 1 });
    await expect(save(failing, [opFor(failing, deals[0].id, 'won')])).rejects.toBeInstanceOf(NetworkError);

    const offline = new FakeServer(deals, { ...quiet, offline: true });
    await expect(save(offline, [opFor(offline, deals[0].id, 'won')])).rejects.toThrow('You are offline');
    expect(offline.stats.failed).toBe(1);
    expect(offline.getDeal(deals[0].id)?.stage).toBe(deals[0].stage); // nothing applied
  });

  it('rejects a move when someone else changed the stage first', async () => {
    const server = new FakeServer(deals, quiet);
    const id = deals[1].id;
    const stale = opFor(server, id, 'won');
    server.teammateEditNow(id, 'stage');
    const [r] = await save(server, [stale]);
    expect(r.status).toBe('conflict');
    expect(server.stats.conflicts).toBe(1);
  });

  it('merges a move when the teammate only changed the value', async () => {
    const server = new FakeServer(deals, quiet);
    const id = deals[2].id;
    const op = opFor(server, id, 'won');
    server.teammateEditNow(id, 'value');
    const [r] = await save(server, [op]);
    expect(r.status).toBe('ok');
  });

  it('never treats my own earlier save as a conflict', async () => {
    const server = new FakeServer(deals, quiet);
    const id = deals[3].id;
    const base = opFor(server, id, 'contacted');
    await save(server, [base]);
    const [r] = await save(server, [{ ...base, toStage: 'demo' }]);
    expect(r.status).toBe('ok');
  });

  it('overrides a conflict when forced ("keep mine")', async () => {
    const server = new FakeServer(deals, quiet);
    const id = deals[4].id;
    const op = opFor(server, id, 'won');
    server.teammateEditNow(id, 'stage');
    const [r] = await save(server, [{ ...op, force: true }]);
    expect(r.status).toBe('ok');
    expect(server.getDeal(id)?.stage).toBe('won');
  });

  it('can force the next save into a conflict, for demos', async () => {
    const server = new FakeServer(deals, { ...quiet, forceConflictNext: true });
    const [r] = await save(server, [opFor(server, deals[5].id, 'won')]);
    expect(r.status).toBe('conflict');
    expect(server.config.forceConflictNext).toBe(false);
  });

  it('reports unknown deals', async () => {
    const server = new FakeServer(deals, quiet);
    const [r] = await save(server, [{ id: 'X', toStage: 'won', baseVersion: 1, baseStage: 'new' }]);
    expect(r.status).toBe('not_found');
  });

  it('handles min > max latency without breaking', async () => {
    const server = new FakeServer(deals, { ...quiet, minLatency: 900, maxLatency: 100 });
    const [r] = await save(server, [opFor(server, deals[6].id, 'won')]);
    expect(r.status).toBe('ok');
  });

  it('pushes teammate edits at the configured rate until stopped', async () => {
    const server = new FakeServer(deals, { ...quiet, teammateRate: 10 });
    const seen: RemoteChange[] = [];
    const unsubscribe = server.subscribe((c) => seen.push(...c));
    server.startTeammates();
    server.startTeammates(); // idempotent
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen.length).toBeGreaterThan(10);
    expect(seen.length).toBeLessThanOrEqual(20);
    expect(seen.every((c) => c.deal.updatedBy !== CURRENT_USER && c.summary.length > 0)).toBe(true);

    server.stopTeammates();
    const before = seen.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen.length).toBe(before);
    unsubscribe();
  });

  it('can be reconfigured while running', () => {
    const server = new FakeServer(deals, quiet);
    server.setConfig({ failureRate: 0.5 });
    expect(server.config).toMatchObject({ failureRate: 0.5, minLatency: 300 });
  });

  it('describes each teammate edit', () => {
    const server = new FakeServer(deals, quiet);
    const seen: RemoteChange[] = [];
    server.subscribe((c) => seen.push(...c));
    server.teammateEditNow(deals[7].id, 'value');
    server.teammateEditNow(deals[8].id, 'stage');
    server.teammateEditNow('missing', 'stage');
    expect(seen.map((c) => c.summary)).toEqual([
      expect.stringMatching(/updated the value$/),
      expect.stringMatching(/moved it to /),
    ]);
  });
});
