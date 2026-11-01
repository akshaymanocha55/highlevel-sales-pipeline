import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useStore } from './context';
import type { Topic } from './pipelineStore';

/** Re-render when a topic changes; read the data straight from the store afterwards. */
export function useTopic(topic: Topic) {
  const store = useStore();
  const subscribe = useCallback((fn: () => void) => store.subscribe(topic, fn), [store, topic]);
  return useSyncExternalStore(subscribe, () => store.getVersion(topic));
}

/** Re-render only when this deal changes (server update, save status, teammate edit). */
export function useRowVersion(id: string) {
  const store = useStore();
  const subscribe = useCallback((fn: () => void) => store.subscribeRow(id, fn), [store, id]);
  return useSyncExternalStore(subscribe, () => store.getRowVersion(id));
}

/** Booleans, so selecting 10,000 deals re-renders only the rows whose answer changed. */
export function useIsSelected(id: string) {
  const store = useStore();
  const subscribe = useCallback((fn: () => void) => store.subscribe('selection', fn), [store]);
  return useSyncExternalStore(subscribe, () => store.selected.has(id));
}

export function useIsFocused(id: string) {
  const store = useStore();
  const subscribe = useCallback((fn: () => void) => store.subscribe('focus', fn), [store]);
  return useSyncExternalStore(subscribe, () => store.focusId === id);
}

/** Re-render every `ms` (relative times, auto-hiding toasts). */
export function useTicker(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** Re-render once at `at` (epoch ms), e.g. to clear a temporary label. */
export function useExpiry(at: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!at) return;
    const t = setTimeout(() => setTick((n) => n + 1), Math.max(0, at - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [at]);
}

// matchMedia is missing in some test environments
const query = (q: string): MediaQueryList | null =>
  typeof window.matchMedia === 'function' ? window.matchMedia(q) : null;

export function useMediaQuery(q: string) {
  const [matches, setMatches] = useState(() => query(q)?.matches ?? false);
  useEffect(() => {
    const mq = query(q);
    if (!mq) return;
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [q]);
  return matches;
}

export const MOBILE_QUERY = '(max-width: 760px)';
