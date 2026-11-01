import { HttpApi, InProcessApi } from '../api/client';
import { FakeServer, type ServerConfig } from '../api/fakeServer';
import { generateDeals } from '../domain/generate';
import { PipelineStore, type StoreOptions } from './pipelineStore';

/** The simulated backend with 50,000 generated deals. */
export function createServer({
  count = 50_000,
  seed = 42,
  config,
}: { count?: number; seed?: number; config?: Partial<ServerConfig> } = {}) {
  const t0 = performance.now();
  const server = new FakeServer(generateDeals(count, seed), config);
  return { server, bootMs: Math.round(performance.now() - t0) };
}

/**
 * The client store. "http" makes real fetch() calls (answered by MSW in the browser);
 * "in-process" calls the server directly (tests, where there is no service worker).
 */
export function createStore(server: FakeServer, transport: 'http' | 'in-process', opts: StoreOptions = {}) {
  return new PipelineStore(transport === 'http' ? new HttpApi(server) : new InProcessApi(server), opts);
}
