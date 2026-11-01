/**
 * Tiny change-notification layer for useSyncExternalStore.
 * - Topics (view, focus, …) carry a version number that bumps on every change.
 * - Rows subscribe per deal id, so a change to one deal re-renders one row.
 * - `emitBatched` coalesces noisy topics to at most once per animation frame.
 */
type Listener = () => void;

const nextFrame: (cb: () => void) => void =
  typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(cb) : (cb) => setTimeout(cb, 16);

export class Emitter<Topic extends string> {
  private versions = new Map<Topic, number>();
  private topics = new Map<Topic, Set<Listener>>();
  private rows = new Map<string, Set<Listener>>();
  private rowVersions = new Map<string, number>();
  private pending = new Set<Topic>();
  private frameRequested = false;

  constructor(private readonly beforeBatchedEmit?: () => void) {}

  subscribe = (topic: Topic, fn: Listener) => {
    let set = this.topics.get(topic);
    if (!set) this.topics.set(topic, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  };

  version = (topic: Topic) => this.versions.get(topic) ?? 0;

  emit(topic: Topic) {
    this.versions.set(topic, this.version(topic) + 1);
    this.topics.get(topic)?.forEach((fn) => fn());
  }

  /** Emit on the next animation frame; repeated calls in the same frame collapse into one. */
  emitBatched(topic: Topic) {
    this.pending.add(topic);
    if (this.frameRequested) return;
    this.frameRequested = true;
    nextFrame(() => {
      this.frameRequested = false;
      this.beforeBatchedEmit?.();
      const topics = [...this.pending];
      this.pending.clear();
      topics.forEach((t) => this.emit(t));
    });
  }

  subscribeRow = (id: string, fn: Listener) => {
    let set = this.rows.get(id);
    if (!set) this.rows.set(id, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.rows.delete(id);
    };
  };

  rowVersion = (id: string) => this.rowVersions.get(id) ?? 0;

  emitRow(id: string) {
    this.rowVersions.set(id, this.rowVersion(id) + 1);
    this.rows.get(id)?.forEach((fn) => fn());
  }
}
