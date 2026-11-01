# Write-up: Sales Pipeline

## What I built and why

One screen: a **prioritised, virtualised list of deals** under a **pipeline bar** (count and ₹ value per stage, each one a filter), with saved views, bulk actions and a save status that is always visible. Each complaint maps to a feature:

| Complaint                                   | Answer                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "I don't know which deals to work on today" | The default **Today** view: my open deals that need action, ranked by a rule anyone can read (close date passed → closes this week → idle 14+ days, bigger deals first). Each row says why. |
| "It didn't save, and nobody told me"        | A save state on every row (Saving → Retrying → Not saved), a header that is never green while anything is unsaved, a review drawer (`E`) and a leave-page warning.                          |
| "Deals keep jumping around"                 | Teammates' edits update rows in place, but the list's **order and membership stay frozen** until I press `R`. A banner counts what's waiting.                                               |
| "Thousands to Lost at quarter end"          | **Quarter-end cleanup** view → `⌘A` → `7`. Batched saves with progress, per-deal failures, "Retry failed" and Undo.                                                                         |
| "I can't use a mouse for long"              | Every action has a key (`j/k`, `Space`, `Shift+↓`, `⌘A`, `1–7`, `]`, `M`, `Z`, `R`, `Y/N`, `?`). ARIA grid pattern, and results are announced in a live region.                             |

## Key UX decisions, and what I rejected

**A list, not a Kanban board.** A column of 10,000 cards can't be worked through, drag-and-drop is the worst interaction for keyboard users and for bulk moves, and a board can't sort by urgency. I kept the board's useful part, the pipeline's shape, as the pipeline bar. _Rejected:_ a board with virtualised columns. It's possible, but it solves the wrong problem.

**Number keys move deals.** `1`–`7` are the stages (shown on every chip) and `]` advances one stage. Moving 3,000 selected deals takes the same keystroke as moving one. _Rejected:_ confirming bulk moves. Undo is safer and faster; confirmation dialogs teach people to click OK without reading.

**My moves leave the view at once; teammates' don't.** If I move a deal out of "New Lead", I expect it to go. If a teammate does, the row stays (dimmed, "leaves this view on refresh") so my cursor never jumps. _Rejected:_ auto-applying remote changes, even "when idle". Any automatic reorder can land between looking at a row and pressing a key.

**Saved views over filter-building.** Four one-key views: Today, My pipeline, Whole team, Quarter-end cleanup. Selection clears when filters change, so a bulk action never touches deals you can't see.

**Desktop-first, but it works on a phone.** Below 760 px each deal becomes a two-line row, and select and move work by tapping.

## Failed saves

- **Two layers of state.** The client keeps what the server confirmed, plus my unconfirmed moves on top; the screen shows both combined. When a save fails, the top layer stops applying and the row rolls back by itself, with no bookkeeping.
- **Transient errors retry quietly** (3 attempts with backoff). At a 10% failure rate a permanent failure is about 0.1%, so the user only hears about failures that need them.
- **Permanent failures wait for a decision:** a red row with Retry/Discard, a header count, and a drawer listing everything unsaved, even deals filtered out of view.
- **One request per deal at a time.** A second move waits for the first response, so an out-of-order response can never overwrite the latest choice.
- **Bulk moves are many small batches** (250 per request, 4 in parallel), so one failed request affects 250 deals, not 7,000, and results are reported per deal.

## Teammates' changes and conflicts

The fake server pushes teammates' edits, standing in for a websocket. The changed row updates and highlights ("↻ Rahul moved it to Demo Done"), and only that row re-renders. Every deal has a `version`; a move carries the version and stage the user saw. The server reports a **conflict only when someone else changed the stage**. A value or owner edit merges silently, because blocking on it would be noise. A conflict shows both sides ("Rahul moved it to Negotiation · Mine / Theirs"), and neither wins silently.

## Loading 50,000 deals

Standard paging, `GET /api/deals?page=N&limit=20`, driven by the virtualised grid: page 1 arrives with the total (so the scrollbar is right from the start), and every other page loads only when its rows scroll into view. Rows still loading show as placeholders, and `End` jumps straight to the last page. Page 1 also returns a **snapshot** id that later pages reuse, so teammates' edits can't shift rows between pages. **Select all** fetches the snapshot's ids once, so a bulk move reaches deals that were never on screen. Stage counts come with page 1 and are then kept current from save results and teammates' pushes, so an idle screen sends no requests. Every request is a real `fetch` answered by MSW inside the browser and shows up in the Network tab. _Rejected:_ polling for counts (constant load for little value), and paging without a snapshot (duplicate or missing rows while others edit).

## Performance

- **Page 1 is requested only on user actions** (filter, search, `R`). The server filters and sorts 50k deals in about 50–140 ms; search is debounced, and older responses that arrive late are ignored.
- **Virtualised rows** (about 30 in the DOM). Each row subscribes to its own deal, and selection and focus subscriptions return booleans, so `⌘A` on 10,000 deals re-renders only the visible rows.
- Sync status updates at most once per frame. Measured traffic: zero requests while idle, one `POST` per move, and 31 `POST`s (nothing else) to move 7,465 deals.
- Measured in headless Chrome: 50k deals generated in about 120 ms, first rows in under 1 s, view switches about 110–160 ms, a 7,468-deal bulk move dispatched in about 140 ms.

## Code and tests

Pure logic (filters, sorting, attention, stages) has no React. Screens are built from a small shared component library (buttons, stage chips, dialogs, panels, form fields), so behaviour like dialog focus handling is written once. The store owns state and sync, the fake API is the only "network", and components get the store through context. That makes the real app testable: **161 tests**, covering the domain, the fake API and its HTTP endpoints, the sync engine and infinite loading, and the whole UI driven by keyboard and mouse. The UI tests caught three bugs before submission: Shift+↓ started the range one row late, the "Calm" simulation preset left Offline on, and the search box cleared a frame late. CI runs typecheck, strict lint, formatting, tests and build.

## With more time

- **A real WebSocket** for teammates' changes, replacing the in-app push. On reconnect, the client asks for every change after the last version it saw (or reloads page 1 if it was away too long). The server batches bulk changes into one message every ~200 ms instead of thousands.
- **Idempotency keys**, so retrying is safe even if the server applied a change but the response was lost.
- **Cursor (keyset) pagination** instead of page numbers, and indexed queries, for 500k+ deals.
- **Persist unsaved moves** (IndexedDB) across reloads.
- **Show who else is viewing a deal**, to prevent conflicts rather than only resolve them.
- **Screen-reader testing** with VoiceOver and NVDA. I followed the ARIA grid pattern but haven't verified it with real users.

**Honest limits:** the attention score is a heuristic, not learned from data. UI tests run in jsdom, which has no layout engine, so scrolling and visuals were checked by hand in Chrome.
