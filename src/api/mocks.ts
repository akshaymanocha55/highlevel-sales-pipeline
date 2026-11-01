import { delay, http, HttpResponse } from 'msw';
import type { MoveOp } from '../domain/types';
import { API, encodeIds, paramsToPage } from './client';
import { NetworkError, type FakeServer } from './fakeServer';

/**
 * The fake backend as real HTTP endpoints. MSW's service worker intercepts the app's fetch()
 * calls inside the browser, so they show up in the Network tab like any API.
 *
 *   GET  /api/deals?page=1&limit=20&…filters[&snapshot=]   one page + total (+ counts on page 1)
 *   GET  /api/deals/ids?snapshot=                           all ids in the list (for "select all")
 *   POST /api/deals/moves                                   { ops, by } → per-deal results; 503 on failure
 */
export function createHandlers(server: FakeServer) {
  return [
    // more specific paths first: "*/api/deals" would also match them
    http.get(`*${API.ids}`, async ({ request }) => {
      await delay(server.readDelay());
      const snapshot = new URL(request.url).searchParams.get('snapshot') ?? '';
      const ids = server.snapshotIds(snapshot);
      if (!ids) return HttpResponse.json({ error: 'Unknown snapshot' }, { status: 404 });
      return HttpResponse.json(encodeIds(ids));
    }),

    http.get(`*${API.deals}`, async ({ request }) => {
      await delay(server.readDelay());
      const q = paramsToPage(new URL(request.url).searchParams);
      return HttpResponse.json(server.queryPage(q.filters, q.me, q.page, q.limit, q.snapshot));
    }),

    http.post(`*${API.moves}`, async ({ request }) => {
      const { ops, by } = (await request.json()) as { ops: MoveOp[]; by: string };
      try {
        // the fake server applies the configured latency and failure rate itself
        return HttpResponse.json(await server.saveMoves(ops, by));
      } catch (e) {
        const message = e instanceof NetworkError ? e.message : 'Save failed';
        return HttpResponse.json({ error: message }, { status: 503 });
      }
    }),
  ];
}
