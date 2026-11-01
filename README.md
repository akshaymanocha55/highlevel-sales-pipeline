# Sales Pipeline: HighLevel frontend assignment

A screen for a 20-person sales team managing one shared pipeline of **50,000 deals**, on a slow and unreliable network, with teammates editing at the same time, and usable entirely from the keyboard. It also works on a phone.

## Run

```bash
git clone <this repo> && cd <repo folder>
npm start
```

`npm start` installs dependencies and opens http://localhost:5173. Requires **Node 22.12+** (Node 20.19+ runs the app; the tests need 22).

- 🌐 **Live demo:** https://highlevel-sales-pipeline.vercel.app (no install needed; the fake API runs inside the browser)
- 📄 **Write-up:** [WRITEUP.md](./WRITEUP.md)
- 🎥 **Walkthrough video:** https://www.loom.com/share/f935f5a587164b609271900b53be97bc

## Try it in 2 minutes

| Do this                                                                           | What you'll see                                                                                                      |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Press `j`/`k`, then `]`                                                           | The deal advances one stage instantly, shows **Saving…**, then **✓ Saved**                                           |
| `Shift+4` (Quarter-end cleanup) → `⌘/Ctrl+A` → `7`                                | ~7,500 idle deals move to Lost in batches, with a progress bar and **Undo**                                          |
| Open **⚙ Simulation** (bottom-right, or `` ` ``) → tick **Offline** → move a deal | Quiet retries, then the row turns red: **Not saved · Retry / Discard**. The header shows `⚠ 1 not saved`             |
| Tick **Next save hits a conflict** → move a deal                                  | "⚠ Rahul moved it · Mine / Theirs" (hover for the details)                                                           |
| Set **Teammate edits** to 40/sec                                                  | Rows update and flash in place, but the list **never reorders under you**. A banner counts changes; `R` applies them |
| Press `?`                                                                         | All keyboard shortcuts                                                                                               |

## The fake API (visible in DevTools → Network)

There's no backend, as the brief asks. The fake server runs in the browser and is exposed as real HTTP endpoints through **MSW** (Mock Service Worker), so every request shows up in the Network tab:

| Request                                                     | When                                                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /api/deals?page=1&limit=20&owner=…&stage=…&q=…&sort=…` | load, filter, search, `R`. Returns 20 deals, the **total**, **stage counts** and a **snapshot** id   |
| `GET /api/deals?page=N&limit=20&snapshot=…`                 | **infinite scroll**: a page loads when its rows come into view                                       |
| `GET /api/deals/ids?snapshot=…`                             | only when you **Select all** and some pages haven't loaded (so a bulk move can reach them)           |
| `POST /api/deals/moves`                                     | saving moves, up to 250 per request. Per-deal `ok` / `conflict`; **503** when a failure is simulated |

- **Why a snapshot:** teammates change deals constantly. Later pages are read from the order page 1 was built on, so rows never shift between pages (no duplicates, no gaps). Each row's details are still current.
- **No count polling:** page 1 brings the stage counts. After that the app adjusts them itself from data it already receives (save results and teammates' pushes), so an idle screen makes **zero** requests.
- **Teammates' changes** are pushed straight from the fake server (a WebSocket in a real app).

Delays, failure rate, offline mode and conflicts are all adjustable in **⚙ Simulation**.

## Scripts

| Command                 | What it does                                          |
| ----------------------- | ----------------------------------------------------- |
| `npm start`             | Install and run the app                               |
| `npm test`              | All tests (unit + UI)                                 |
| `npm run test:coverage` | Tests with a coverage report (`coverage/index.html`)  |
| `npm run check`         | Typecheck, lint, format check and tests: what CI runs |
| `npm run build`         | Production build                                      |

## Architecture

```
src/
  domain/      pure logic, no React: types, seeded data generator, filters/sorting,
               "needs attention" rules, stage rules
  api/         FakeServer (data, latency, failures, conflicts, teammates), MSW handlers (HTTP endpoints),
               client.ts: the PipelineApi the store uses (HttpApi in the app, InProcessApi in tests)
  store/       PipelineStore: optimistic moves, batching, retries, conflicts, undo, view snapshot
               Emitter: per-topic and per-row change notifications for useSyncExternalStore
               context.tsx / hooks.ts: the React bindings
  ui/
    components/  shared library: Button, IconButton, StageChip, Avatar, ProgressBar, Spinner, Kbd,
                 Dialog (modal: focus trap, Escape, focus return), Panel, SelectField, CheckboxField, RangeField
    table/       virtualised grid, row, sync cell, empty states
    toolbar/     views, pipeline bar, filters, banners, bulk actions
    sync/        save status, progress cards, unsaved-changes drawer, screen-reader announcements
    overlays/    stage picker, keyboard help, simulation panel
    useShortcuts.ts
  lib/         formatting and DOM helpers
  App.tsx      layout
```

- **Data flows one way.** Components read from `PipelineStore` and call its methods. The store talks to `FakeServer`, the only thing that pretends to be the network.
- **Two layers of state.** `server` holds what the backend confirmed; `pending` holds my unconfirmed moves on top. What you see is the two combined, so a failed save rolls back by itself.
- **Fine-grained updates.** Each row subscribes to its own deal, so a teammate's edit or a save response re-renders one row out of 50,000.
- **One component library.** Screens compose shared components and never hand-roll buttons, chips, dialogs or form fields. Dialog behaviour (focus, Escape, focus return, Tab trap) lives in one place.
- **Dependency injection.** The store reaches components through React context. Tests render the real app with a small store and a fast, quiet fake server.

Stack: React 19, TypeScript (strict), Vite, `@tanstack/react-virtual`. Quality: ESLint (`strictTypeChecked`), Prettier, Vitest + Testing Library, GitHub Actions CI.

## Tests

161 tests:

- **Domain:** filters, sorting, attention rules, stage stepping, data generator (determinism, 50k unique IDs)
- **HTTP API through MSW:** paging with snapshots, ids, saves, 503 failures, dropped connections, query-string encoding
- **Fake API:** latency, failures, offline, conflict rules (stage vs value edits, own writes, force), teammate event rate
- **Sync engine:** optimistic updates, rollback, retry with backoff, out-of-order responses, conflicts, bulk batching, partial failure, undo, held-back live updates, focus and selection rules, dispose
- **Components:** every shared component, including dialog focus trapping and focus return
- **UI (jsdom):** the full app driven by keyboard and mouse: navigation, selection, moves, failure → review → retry, conflicts, live-update banner, empty states, stage picker, simulation panel, unsaved-work warning
