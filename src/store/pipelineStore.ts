import type { PipelineApi } from '../api/client';
import { NetworkError } from '../api/fakeServer';
import {
  DEFAULT_FILTERS,
  emptyCounts,
  matchesFilters,
  normalizeSearch,
  PRESETS,
  sortKey,
  type Filters,
  type PresetId,
  type StageCounts,
} from '../domain/filters';
import { CURRENT_USER } from '../domain/generate';
import { stepStage } from '../domain/stages';
import {
  isOpen,
  STAGE_LABEL,
  type Deal,
  type MoveOp,
  type MoveResult,
  type RemoteChange,
  type Stage,
} from '../domain/types';
import { plural } from '../lib/text';
import { Emitter } from './emitter';

/*
  PipelineStore — the client side of the app.

  Loading (infinite scroll, page by page):
    - a filter change asks for page 1: 20 deals, the total, stage counts and a snapshot id
    - other pages (page=N&limit=20, same snapshot) load only when their rows scroll into view
    - rows not loaded yet render as placeholders; the scrollbar already knows the total
    - "select all" fetches the snapshot's ids once, so bulk moves can reach unloaded rows

  Data model (two layers):
    deals    deals the server has sent us (pages, save results, teammates' pushes)
    pending  my unconfirmed moves, drawn on top
  What the user sees is getDeal(id) = server deal + pending stage (while saving).
  A failed save therefore "rolls back" by itself: the pending layer stops applying.

  Sync rules:
    - moves are optimistic and batched (BATCH_SIZE per request, MAX_CONCURRENT requests)
    - at most one request per deal is in flight; a newer move waits, so an old response
      can never overwrite a newer choice
    - network errors retry with backoff; after MAX_ATTEMPTS the row shows "Not saved"
    - conflicts (a teammate changed the stage first) are never resolved silently

  View rules:
    - viewIds is a snapshot. Teammates' changes update rows in place but never reorder
      the list; they are counted in `stale` until the user refreshes.
    - the user's own moves remove rows that no longer match, right away.
*/

export type { Filters, PresetId, SortKey, StageFilter } from '../domain/filters';
export { PRESETS } from '../domain/filters';

export type SaveStatus = 'saving' | 'retrying' | 'failed' | 'conflict';

export interface PendingMove {
  id: string;
  toStage: Stage;
  /** server state the user was looking at when they made the move (version unknown if never loaded) */
  baseVersion?: number;
  baseStage: Stage;
  status: SaveStatus;
  attempts: number;
  jobId: number;
  /** skip conflict detection: the user chose "keep mine" */
  force?: boolean;
  error?: string;
  /** on conflict: what the teammate did */
  theirs?: { stage: Stage; by: string };
}

/** One user action (a move, an undo, a retry) and the deals it touched. Drives progress + undo. */
export interface Job {
  id: number;
  kind: 'move' | 'undo' | 'retry';
  label: string;
  toStage: Stage | null;
  ids: string[];
  /** stage each deal showed before this job, for undo */
  prev: Map<string, Stage>;
  undone: boolean;
  dismissed: boolean;
}

export interface JobProgress {
  total: number;
  saving: number;
  /** gave up after retries: the user can retry or discard */
  failed: number;
  /** a teammate moved the deal meanwhile: the user picks mine or theirs */
  conflicts: number;
  done: number;
}

export type Topic = 'view' | 'focus' | 'selection' | 'meta';

export interface StoreOptions {
  me?: string;
  clock?: () => number;
  batchSize?: number;
  maxConcurrent?: number;
  maxAttempts?: number;
  /** delay before attempt n+1, indexed by attempts so far */
  backoffMs?: number[];
  /** rows fetched per page as the user scrolls */
  pageSize?: number;
}

export const BATCH_SIZE = 250;
export const MAX_CONCURRENT_REQUESTS = 4;
export const MAX_ATTEMPTS = 3;
export const PAGE_SIZE = 20;
const BACKOFF_MS = [0, 600, 1500];
const MAX_JOBS_KEPT = 20;

const isUnresolved = (p: PendingMove | undefined): p is PendingMove =>
  p?.status === 'failed' || p?.status === 'conflict';
const isActive = (p: PendingMove | undefined): p is PendingMove => p?.status === 'saving' || p?.status === 'retrying';

export class PipelineStore {
  readonly me: string;
  readonly api: PipelineApi;

  /** deals the server has sent us */
  private readonly deals = new Map<string, Deal>();
  /** stage of every deal in the current list, known before its details are loaded */
  private readonly stageHint = new Map<string, Stage>();
  /** optimistic moves not yet confirmed */
  readonly pending = new Map<string, PendingMove>();

  filters: Filters = { ...DEFAULT_FILTERS };
  /** the server's id for the current list order; pages are requested against it */
  private snapshot: string | null = null;
  /** ids by position in the snapshot; '' where that page hasn't loaded yet */
  private rows: string[] = [];
  /** id -> position in the snapshot */
  private readonly indexOf = new Map<string, number>();
  /** visible positions, in order: the snapshot minus rows the user's own moves took out */
  private display: number[] = [];
  private viewIdsCache: string[] | null = null;
  /** a list request is on its way */
  viewLoading = false;
  viewError: string | null = null;
  /** deals whose place in the current view changed but isn't shown yet */
  readonly stale = new Set<string>();

  focusIndex = 0;
  readonly selected = new Set<string>();
  private anchorIndex = -1;

  counts: StageCounts = emptyCounts();
  jobs: Job[] = [];
  private nextJobId = 1;

  /** id -> when a teammate last changed it and what they did (row highlight) */
  readonly remoteFlash = new Map<string, { at: number; summary: string }>();
  /** id -> when the server confirmed my last move (short "✓ Saved") */
  readonly savedAt = new Map<string, number>();
  announcement = { text: '', n: 0 };

  // list + page loading
  private viewGen = 0;
  private viewRequest: Promise<void> = Promise.resolve();
  private readonly pagesRequested = new Set<number>();
  private selectAllRequest: Promise<void> | null = null;
  private readonly pageRequests = new Set<Promise<void>>();

  // saving
  private readonly queue = new Set<string>();
  /** id -> stage currently on the wire */
  private readonly inFlight = new Map<string, Stage>();
  private activeRequests = 0;
  private pumpScheduled = false;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;

  private readonly clock: () => number;
  private readonly batchSize: number;
  private readonly maxConcurrent: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number[];
  readonly pageSize: number;
  /** snapshot positions removed by the user's own moves */
  private readonly hidden = new Set<number>();

  private readonly emitter = new Emitter<Topic>();
  private readonly unsubscribeServer: () => void;

  constructor(api: PipelineApi, opts: StoreOptions = {}) {
    this.api = api;
    this.me = opts.me ?? CURRENT_USER;
    this.clock = opts.clock ?? Date.now;
    this.batchSize = opts.batchSize ?? BATCH_SIZE;
    this.maxConcurrent = opts.maxConcurrent ?? MAX_CONCURRENT_REQUESTS;
    this.maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
    this.backoffMs = opts.backoffMs ?? BACKOFF_MS;
    this.pageSize = opts.pageSize ?? PAGE_SIZE;
    this.unsubscribeServer = api.subscribe((changes) => this.applyRemote(changes));
    this.loadView();
  }

  dispose() {
    this.disposed = true;
    this.unsubscribeServer();
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }

  /** Resolves once the current list and any page requests have arrived (handy in tests). */
  async whenLoaded() {
    await this.viewRequest;
    await Promise.all([...this.pageRequests]);
    if (this.selectAllRequest) await this.selectAllRequest;
  }

  /* ------------------------------------------------------------ reading */

  /** How many deals the current list holds (loaded or not). */
  get size() {
    return this.display.length;
  }

  /** Ids of the rows on screen, in order. '' marks a row whose page hasn't loaded yet. */
  get viewIds(): string[] {
    this.viewIdsCache ??= this.display.map((i) => this.rows[i]);
    return this.viewIdsCache;
  }

  private viewChanged() {
    this.viewIdsCache = null;
    this.emitter.emit('view');
  }

  private isInView(id: string) {
    const i = this.indexOf.get(id);
    return i !== undefined && !this.hidden.has(i);
  }

  /** What the user sees: the server's deal with my unconfirmed move on top. Undefined until loaded. */
  getDeal(id: string): Deal | undefined {
    const s = this.deals.get(id);
    if (!s) return undefined;
    const p = this.pending.get(id);
    return isActive(p) && p.toStage !== s.stage ? { ...s, stage: p.toStage } : s;
  }

  getServerDeal(id: string) {
    return this.deals.get(id);
  }

  getPending(id: string) {
    return this.pending.get(id);
  }

  isLoaded(id: string) {
    return this.deals.has(id);
  }

  /** The stage the user sees, even for rows whose details haven't loaded. */
  stageOf(id: string): Stage | undefined {
    const p = this.pending.get(id);
    if (isActive(p)) return p.toStage;
    return this.deals.get(id)?.stage ?? this.stageHint.get(id);
  }

  /** The stage the server last told us. */
  private serverStageOf(id: string): Stage | undefined {
    return this.deals.get(id)?.stage ?? this.stageHint.get(id);
  }

  get focusId(): string | undefined {
    return this.viewIds[this.focusIndex] || undefined;
  }

  now() {
    return this.clock();
  }

  matches(d: Deal, now = this.clock()) {
    return matchesFilters(d, this.filters, this.me, now);
  }

  /** For rows without details: does a deal in this stage still fit the stage filter? */
  private stageFits(stage: Stage) {
    const f = this.filters.stage;
    return f === 'all' || (f === 'open' ? isOpen(stage) : f === stage);
  }

  syncSummary() {
    let saving = 0;
    let failed = 0;
    let conflicts = 0;
    for (const p of this.pending.values()) {
      if (p.status === 'failed') failed++;
      else if (p.status === 'conflict') conflicts++;
      else saving++;
    }
    return { saving, failed, conflicts };
  }

  jobProgress(job: Job): JobProgress {
    let saving = 0;
    let failed = 0;
    let conflicts = 0;
    for (const id of job.ids) {
      const p = this.pending.get(id);
      if (p?.jobId !== job.id) continue;
      if (p.status === 'conflict') conflicts++;
      else if (isUnresolved(p)) failed++;
      else saving++;
    }
    const total = job.ids.length;
    return { total, saving, failed, conflicts, done: total - saving - failed - conflicts };
  }

  /* ------------------------------------------------------ subscriptions */

  subscribe = (topic: Topic, fn: () => void) => this.emitter.subscribe(topic, fn);
  getVersion = (topic: Topic) => this.emitter.version(topic);
  subscribeRow = (id: string, fn: () => void) => this.emitter.subscribeRow(id, fn);
  getRowVersion = (id: string) => this.emitter.rowVersion(id);

  /** sync status, jobs, counts: batched to one update per frame */
  private metaChanged() {
    this.emitter.emitBatched('meta');
  }

  announce(text: string) {
    this.announcement = { text, n: this.announcement.n + 1 };
    this.metaChanged();
  }

  /* ---------------------------------------------------- list + loading */

  setFilters(patch: Partial<Filters>) {
    const next = { ...this.filters, ...patch };
    if (!('preset' in patch)) next.preset = null;
    if (patch.search !== undefined) next.search = normalizeSearch(patch.search);
    this.filters = next;
    this.selected.clear();
    this.anchorIndex = -1;
    this.focusIndex = 0;
    this.emitter.emit('view'); // filters are part of the view: controls update at once
    this.emitter.emit('selection');
    this.emitter.emit('focus');
    this.loadView();
  }

  applyPreset(id: PresetId) {
    this.setFilters({ preset: id, search: '', ...PRESETS[id].filters });
  }

  /** Apply held-back changes: fetch the list again, keeping the cursor on the same deal. */
  refreshView() {
    this.loadView({ keepFocus: true });
  }

  /**
   * Ask for page 1 of the list. The previous rows stay on screen until it arrives
   * (no flash of empty content); answers to older requests are ignored.
   */
  private loadView({ keepFocus = false } = {}) {
    const gen = ++this.viewGen;
    const focusId = keepFocus ? this.focusId : undefined;
    this.viewLoading = true;
    this.viewError = null;
    this.metaChanged();

    this.viewRequest = this.api.fetchPage({ filters: this.filters, me: this.me, page: 1, limit: this.pageSize }).then(
      (res) => {
        if (this.disposed || gen !== this.viewGen) return;
        this.snapshot = res.snapshot;
        this.rows = new Array<string>(res.total).fill('');
        this.indexOf.clear();
        this.hidden.clear();
        this.display = Array.from({ length: res.total }, (_, i) => i);
        this.pagesRequested.clear();
        this.pagesRequested.add(1);
        this.placePage(1, res.limit, res.items);
        if (res.counts) this.counts = res.counts;
        this.stale.clear();
        this.viewLoading = false;

        const idx = focusId ? this.displayIndexOf(focusId) : -1;
        this.focusIndex = idx >= 0 ? idx : this.clampIndex(this.focusIndex);
        // never leave hidden rows selected: a bulk action must only touch what the user can see
        let dropped = false;
        for (const id of this.selected) {
          if (!this.isInView(id)) {
            this.selected.delete(id);
            dropped = true;
          }
        }
        if (dropped) this.emitter.emit('selection');

        this.viewChanged();
        this.emitter.emit('focus');
        this.metaChanged();
        this.loadRange(this.focusIndex, this.focusIndex + this.pageSize - 1);
      },
      (e: unknown) => {
        if (this.disposed || gen !== this.viewGen) return;
        this.viewLoading = false;
        this.viewError = e instanceof Error ? e.message : 'Could not load deals';
        this.metaChanged();
      },
    );
  }

  /** Put a page's deals into their positions in the snapshot. */
  private placePage(page: number, limit: number, items: Deal[]) {
    const start = (page - 1) * limit;
    items.forEach((d, k) => {
      this.rows[start + k] = d.id;
      this.indexOf.set(d.id, start + k);
      this.receive(d);
    });
  }

  private displayIndexOf(id: string) {
    const i = this.indexOf.get(id);
    return i === undefined ? -1 : this.display.indexOf(i);
  }

  /**
   * Infinite scroll: make sure rows `from`..`to` (screen positions) are loaded.
   * Requests each missing page (page=N&limit=20&snapshot=…) once.
   */
  loadRange(from: number, to: number) {
    if (!this.display.length || !this.snapshot) return;
    const clamp = (i: number) => Math.max(0, Math.min(i, this.display.length - 1));
    const lo = this.display[clamp(from)];
    const hi = this.display[clamp(to)];
    const first = Math.floor(lo / this.pageSize) + 1;
    const last = Math.floor(hi / this.pageSize) + 1;
    const snapshot = this.snapshot;
    const gen = this.viewGen;
    for (let page = first; page <= last; page++) {
      if (this.pagesRequested.has(page)) continue;
      this.pagesRequested.add(page);
      const req: Promise<void> = this.api
        .fetchPage({ filters: this.filters, me: this.me, page, limit: this.pageSize, snapshot })
        .then(
          (res) => {
            if (this.disposed || gen !== this.viewGen) return;
            if (res.snapshot !== snapshot) {
              // the server forgot our snapshot: start the list again
              this.loadView({ keepFocus: true });
              return;
            }
            this.placePage(page, res.limit, res.items);
            this.viewChanged();
          },
          () => {
            // let the next scroll try this page again
            if (gen === this.viewGen) this.pagesRequested.delete(page);
          },
        );
      this.pageRequests.add(req);
      void req.finally(() => this.pageRequests.delete(req));
    }
  }

  /** Take a deal from the server unless we already have a newer version. */
  private receive(d: Deal) {
    const cur = this.deals.get(d.id);
    if (cur && cur.version >= d.version) return false;
    this.deals.set(d.id, d);
    this.stageHint.set(d.id, d.stage);
    this.emitter.emitRow(d.id);
    return true;
  }

  private clampIndex(i: number) {
    return Math.max(0, Math.min(i, this.display.length - 1));
  }

  /** After a change the user did NOT make: never move rows, just remember the view is out of date. */
  private markIfStale(id: string, before: Deal | undefined) {
    const after = this.getDeal(id);
    if (!after) return;
    const now = this.clock();
    // a deal on a page we haven't loaded: we can't tell where it sits, so don't guess
    if (!this.indexOf.has(id)) return;
    const shown = this.isInView(id);
    if (shown !== this.matches(after, now)) {
      this.stale.add(id);
    } else if (shown && before && sortKey(before, this.filters.sort, now) !== sortKey(after, this.filters.sort, now)) {
      this.stale.add(id);
    }
  }

  /** After the user's own move: rows that no longer fit leave the view now, as they expect. */
  private removeOwnLeavers(ids: string[]) {
    const now = this.clock();
    const leaving = new Set<number>();
    for (const id of ids) {
      const i = this.indexOf.get(id);
      if (i === undefined || this.hidden.has(i)) continue;
      const d = this.getDeal(id);
      const stage = this.stageOf(id);
      const fits = d ? this.matches(d, now) : stage === undefined || this.stageFits(stage);
      if (!fits) leaving.add(i);
    }
    if (leaving.size) {
      const focusId = this.focusId;
      const oldIndex = this.focusIndex;
      leaving.forEach((i) => {
        this.hidden.add(i);
        this.stale.delete(this.rows[i]);
      });
      this.display = this.display.filter((i) => !leaving.has(i));
      // keep the cursor on the same deal, or on the row that slid into its place
      const idx = focusId ? this.displayIndexOf(focusId) : -1;
      this.focusIndex = idx >= 0 ? idx : this.clampIndex(oldIndex);
      this.viewChanged();
      this.emitter.emit('focus');
    }
    this.clearSelection();
  }

  /* ----------------------------------------------------- focus/selection */

  setFocus(index: number) {
    const i = this.clampIndex(index);
    if (i === this.focusIndex) return;
    this.focusIndex = i;
    this.emitter.emit('focus');
  }

  toggleSelect(id: string, index?: number) {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    if (index !== undefined) this.anchorIndex = index;
    this.emitter.emit('selection');
  }

  /**
   * Shift+click / Shift+arrow: select everything between the anchor and `index`.
   * With no anchor yet, the range starts at `start` (the row the cursor was on before it moved).
   */
  selectRange(index: number, start = this.focusIndex) {
    const anchor = this.anchorIndex >= 0 ? this.anchorIndex : start;
    const [lo, hi] = anchor < index ? [anchor, index] : [index, anchor];
    const ids = this.viewIds;
    for (let i = lo; i <= hi; i++) {
      const id = ids[i];
      if (id) this.selected.add(id); // rows still loading can't be picked yet
    }
    this.anchorIndex = anchor;
    this.emitter.emit('selection');
  }

  /**
   * Select every deal in the list. If some pages haven't loaded, first fetch the list's ids
   * (one request), so bulk actions can reach rows that were never on screen.
   */
  selectAll() {
    if (!this.viewIds.includes('')) {
      this.finishSelectAll();
      return;
    }
    if (this.selectAllRequest || !this.snapshot) return;
    const gen = this.viewGen;
    this.announce('Selecting all deals…');
    this.selectAllRequest = this.api
      .fetchIds(this.snapshot)
      .then(
        ({ ids, stages }) => {
          if (this.disposed || gen !== this.viewGen) return;
          ids.forEach((id, i) => {
            this.rows[i] = id;
            this.indexOf.set(id, i);
            if (!this.deals.has(id)) this.stageHint.set(id, stages[i]);
          });
          this.viewIdsCache = null;
          this.finishSelectAll();
          this.viewChanged();
        },
        () => this.announce("Couldn't select all deals. Try again."),
      )
      .finally(() => {
        this.selectAllRequest = null;
      });
  }

  private finishSelectAll() {
    this.viewIds.forEach((id) => {
      if (id) this.selected.add(id);
    });
    this.emitter.emit('selection');
    this.announce(`${plural(this.selected.size, 'deal')} selected`);
  }

  clearSelection() {
    if (!this.selected.size) return;
    this.selected.clear();
    this.anchorIndex = -1;
    this.emitter.emit('selection');
  }

  /** What an action applies to: the selection, or else the focused row. */
  targetIds(): string[] {
    if (this.selected.size) return [...this.selected];
    return this.focusId ? [this.focusId] : [];
  }

  /* -------------------------------------------------------------- moves */

  /** Move deals to a stage. Optimistic: the screen changes now, saving happens in the background. */
  move(ids: string[], toStage: Stage): Job | null {
    const job = this.newJob('move', toStage);
    for (const id of ids) {
      const shown = this.stageOf(id);
      if (!shown || (shown === toStage && !isUnresolved(this.pending.get(id)))) continue;
      job.ids.push(id);
      job.prev.set(id, shown);
      this.setIntent(id, toStage, job.id);
    }
    if (!job.ids.length) return null;
    const name = this.deals.get(job.ids[0])?.company ?? job.ids[0];
    job.label =
      job.ids.length === 1
        ? `Moved ${name} to ${STAGE_LABEL[toStage]}`
        : `Moved ${plural(job.ids.length, 'deal')} to ${STAGE_LABEL[toStage]}`;
    this.addJob(job);
    this.removeOwnLeavers(job.ids);
    this.announce(`${job.label}. Saving…`);
    return job;
  }

  /** Move each deal one stage forward (1) or back (-1). Deals already at the end are skipped. */
  step(ids: string[], dir: 1 | -1) {
    const byDest = new Map<Stage, string[]>();
    for (const id of ids) {
      const stage = this.stageOf(id);
      const next = stage && stepStage(stage, dir);
      if (next) byDest.set(next, [...(byDest.get(next) ?? []), id]);
    }
    byDest.forEach((group, dest) => this.move(group, dest));
  }

  /** Re-send failed saves. On a conflict this means "keep mine", so it overrides the teammate. */
  retry(ids: string[]) {
    const job = this.newJob('retry', null);
    for (const id of ids) {
      const p = this.pending.get(id);
      const serverStage = this.serverStageOf(id);
      if (!isUnresolved(p) || !serverStage) continue;
      job.ids.push(id);
      job.prev.set(id, serverStage);
      this.setIntent(id, p.toStage, job.id, p.status === 'conflict');
    }
    if (!job.ids.length) return;
    job.label = `Retrying ${plural(job.ids.length, 'deal')}`;
    this.addJob(job);
    this.announce(job.label);
  }

  /** Conflict resolution: overwrite the teammate's stage with mine. */
  keepMine(ids: string[]) {
    this.retry(ids);
  }

  /** Give up on my change and accept the server's version (failed save or a teammate's change). */
  discard(ids: string[]) {
    let n = 0;
    for (const id of ids) {
      if (!isUnresolved(this.pending.get(id))) continue;
      const before = this.getDeal(id);
      this.dropPending(id);
      this.markIfStale(id, before);
      n++;
    }
    if (!n) return;
    this.metaChanged();
    this.announce(`Discarded ${plural(n, 'change')}`);
  }

  /** Put every deal from a job back where it was. Defaults to the latest move. */
  undo(jobId?: number) {
    const job =
      jobId !== undefined
        ? this.jobs.find((j) => j.id === jobId)
        : this.jobs.find((j) => j.kind === 'move' && !j.undone);
    if (!job || job.undone || job.kind !== 'move' || !job.toStage) return;
    job.undone = true;
    const movedTo = job.toStage;

    const undoJob = this.newJob('undo', null);
    for (const id of job.ids) {
      const p = this.pending.get(id);
      if (isUnresolved(p) && p.jobId === job.id) {
        this.dropPending(id); // it never saved; nothing to put back
        continue;
      }
      // a later action moved it on; don't fight it
      const prev = job.prev.get(id);
      if (!prev || this.stageOf(id) !== movedTo) continue;
      undoJob.ids.push(id);
      undoJob.prev.set(id, movedTo);
      this.setIntent(id, prev, undoJob.id);
    }
    undoJob.label = `Undo: ${job.label}`;
    if (undoJob.ids.length) this.addJob(undoJob);
    this.announce(undoJob.label);
    // undo is the user's own action, so bring the deals back into the list
    this.refreshView();
  }

  dismissJob(id: number) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    job.dismissed = true;
    this.metaChanged();
  }

  private newJob(kind: Job['kind'], toStage: Stage | null): Job {
    return {
      id: this.nextJobId++,
      kind,
      label: '',
      toStage,
      ids: [],
      prev: new Map(),
      undone: false,
      dismissed: false,
    };
  }

  private addJob(job: Job) {
    this.jobs = [job, ...this.jobs].slice(0, MAX_JOBS_KEPT);
    this.metaChanged();
    this.schedulePump();
  }

  /** Record what the user wants this deal to be and queue a save. */
  private setIntent(id: string, toStage: Stage, jobId: number, force = false) {
    const serverStage = this.serverStageOf(id);
    if (!serverStage) return;
    // back to what the server already has, with nothing on the wire: nothing to save
    if (toStage === serverStage && !this.inFlight.has(id)) {
      this.dropPending(id);
      return;
    }
    const existing = this.pending.get(id);
    this.pending.set(id, {
      id,
      toStage,
      // keep the base from the first move: that's what the user originally looked at
      baseVersion: existing ? existing.baseVersion : this.deals.get(id)?.version,
      baseStage: existing?.baseStage ?? serverStage,
      status: 'saving',
      attempts: 0,
      jobId,
      force: force || undefined,
    });
    this.queue.add(id);
    this.emitter.emitRow(id);
  }

  private dropPending(id: string) {
    this.pending.delete(id);
    this.queue.delete(id);
    this.emitter.emitRow(id);
  }

  /* --------------------------------------------------------------- sync */

  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(t);
  }

  private schedulePump() {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    // let a burst of moves (select-all → 7) land in the queue before batching
    this.later(() => {
      this.pumpScheduled = false;
      this.pump();
    }, 0);
  }

  private pump() {
    while (this.activeRequests < this.maxConcurrent && this.queue.size) {
      const batch: string[] = [];
      for (const id of this.queue) {
        if (this.inFlight.has(id)) continue; // one request per deal at a time
        batch.push(id);
        if (batch.length >= this.batchSize) break;
      }
      if (!batch.length) return;
      batch.forEach((id) => this.queue.delete(id));
      void this.send(batch);
    }
  }

  private async send(ids: string[]) {
    const ops: MoveOp[] = [];
    for (const id of ids) {
      const p = this.pending.get(id);
      if (!isActive(p)) continue;
      ops.push({ id, toStage: p.toStage, baseVersion: p.baseVersion, baseStage: p.baseStage, force: p.force });
      this.inFlight.set(id, p.toStage);
    }
    if (!ops.length) return;

    this.activeRequests++;
    try {
      const results = await this.api.saveMoves(ops, this.me);
      if (!this.disposed) this.onSaved(results);
    } catch (error) {
      if (!this.disposed) this.onRequestFailed(ops, error);
    } finally {
      this.activeRequests--;
    }
    if (this.disposed) return;
    this.metaChanged();
    this.pump();
  }

  private onSaved(results: MoveResult[]) {
    for (const r of results) {
      const sent = this.inFlight.get(r.id);
      this.inFlight.delete(r.id);
      const p = this.pending.get(r.id);
      const before = this.getDeal(r.id);
      const oldStage = this.serverStageOf(r.id);
      if (r.status !== 'not_found' && this.receive(r.deal)) this.adjustCounts(r.deal, oldStage);

      if (r.status === 'not_found') {
        this.pending.delete(r.id);
      } else if (r.status === 'ok') {
        if (isActive(p)) {
          if (p.toStage === sent) {
            this.pending.delete(r.id);
            this.savedAt.set(r.id, this.clock());
          } else {
            // the user moved it again while this was on the wire: send the newer choice
            this.queue.add(r.id);
          }
        }
      } else {
        if (p) {
          p.status = 'conflict';
          p.theirs = { stage: r.deal.stage, by: r.deal.updatedBy };
          p.baseVersion = r.deal.version;
          p.baseStage = r.deal.stage;
          this.announce(`Conflict on ${r.deal.company}: ${r.deal.updatedBy} moved it to ${STAGE_LABEL[r.deal.stage]}`);
        }
      }
      this.emitter.emitRow(r.id);
      if (r.status !== 'ok') this.markIfStale(r.id, before);
    }
  }

  private onRequestFailed(ops: MoveOp[], error: unknown) {
    const message = error instanceof NetworkError ? error.message : 'Save failed';
    let gaveUp = 0;
    for (const op of ops) {
      const sent = this.inFlight.get(op.id);
      this.inFlight.delete(op.id);
      const p = this.pending.get(op.id);
      if (!isActive(p)) continue;
      if (p.toStage !== sent) {
        this.queue.add(op.id); // a newer choice exists; send that instead
        continue;
      }
      p.attempts++;
      if (p.attempts < this.maxAttempts) {
        // transient: retry quietly, the row shows "Retrying…"
        p.status = 'retrying';
        const { jobId } = p;
        this.later(() => {
          const cur = this.pending.get(op.id);
          if (cur?.status === 'retrying' && cur.jobId === jobId) {
            this.queue.add(op.id);
            this.schedulePump();
          }
        }, this.backoffMs[p.attempts] ?? 2000);
        this.emitter.emitRow(op.id);
      } else {
        const before = this.getDeal(op.id);
        p.status = 'failed';
        p.error = message;
        gaveUp++;
        this.emitter.emitRow(op.id);
        this.markIfStale(op.id, before);
      }
    }
    if (gaveUp) this.announce(`${plural(gaveUp, 'save')} failed. Press E to review.`);
  }

  /* ------------------------------------------------------------- remote */

  /**
   * Keep stage counts current without asking the server: page 1 brings the counts, and every
   * stage change we hear about afterwards (my save results, teammates' pushes) shifts one deal
   * between stages locally. The next list load re-syncs them with the server anyway.
   */
  private adjustCounts(deal: Deal, oldStage: Stage | undefined) {
    if (!oldStage || oldStage === deal.stage) return;
    if (!matchesFilters(deal, { ...this.filters, stage: 'all' }, this.me, this.clock())) return;
    const c = { ...this.counts };
    const bump = (k: keyof StageCounts, n: number) => {
      c[k] = { count: Math.max(0, c[k].count + n), value: Math.max(0, c[k].value + n * deal.value) };
    };
    bump(oldStage, -1);
    bump(deal.stage, 1);
    if (isOpen(oldStage) !== isOpen(deal.stage)) bump('open', isOpen(deal.stage) ? 1 : -1);
    this.counts = c;
  }

  /** Teammates' changes. Rows update in place; the list order never changes by itself. */
  private applyRemote(changes: RemoteChange[]) {
    const now = this.clock();
    let any = false;
    for (const { deal, summary } of changes) {
      const before = this.getDeal(deal.id);
      const oldStage = this.serverStageOf(deal.id);
      if (!this.receive(deal)) continue; // duplicate or out-of-order event
      this.adjustCounts(deal, oldStage);
      any = true;
      this.remoteFlash.set(deal.id, { at: now, summary });
      this.markIfStale(deal.id, before);
    }
    if (!any) return;
    this.metaChanged();
  }
}
