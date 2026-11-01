import { InProcessApi } from '../api/client';
import { FakeServer, type ServerConfig } from '../api/fakeServer';
import type { Filters } from '../domain/filters';
import { generateDeals } from '../domain/generate';
import type { Stage } from '../domain/types';
import { PipelineStore, type StoreOptions } from '../store/pipelineStore';

/** Fast, quiet defaults for tests: tiny latency, no random failures, no teammates. */
export const QUIET: Partial<ServerConfig> = {
  minLatency: 2,
  maxLatency: 8,
  failureRate: 0,
  teammateRate: 0,
  readLatency: 0,
};

/** Wait for the current list and every row's details (tests look at all rows, not just a screenful). */
export async function loaded(store: PipelineStore) {
  await store.whenLoaded();
  store.loadRange(0, store.viewIds.length);
  await store.whenLoaded();
}

/** Change filters and wait for the new list. */
export async function view(store: PipelineStore, patch: Partial<Filters>) {
  store.setFilters(patch);
  await loaded(store);
}

export async function refresh(store: PipelineStore) {
  store.refreshView();
  await loaded(store);
}

/**
 * A store talking to an in-process fake server (no service worker in tests).
 * Starts on "everything, highest value first", fully loaded.
 */
export async function makeStore(count = 500, server: Partial<ServerConfig> = {}, opts: StoreOptions = {}) {
  const deals = generateDeals(count, 1);
  const api = new FakeServer(deals, { ...QUIET, ...server });
  const store = new PipelineStore(new InProcessApi(api), { backoffMs: [0, 5, 10], ...opts });
  await view(store, { owner: 'all', stage: 'all', attentionOnly: false, idle: 0, sort: 'value' });
  return { api, store, deals };
}

/** Wait until nothing is saving or retrying. */
export async function settle(store: PipelineStore, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (store.syncSummary().saving === 0) {
      await store.whenLoaded();
      return;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('store did not settle');
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export function firstIn(store: PipelineStore, stage: Stage): string {
  const id = store.viewIds.find((i) => store.stageOf(i) === stage);
  if (!id) throw new Error(`no deal in ${stage}`);
  return id;
}
