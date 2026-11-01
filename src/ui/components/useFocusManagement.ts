import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus `ref` (or its first `[data-autofocus]` child) when it mounts, and give focus back to
 * whatever had it before when it unmounts. Keyboard users land where they left off.
 */
export function useFocusOnMount(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = ref.current;
    const target = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el;
    target?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [ref]);
}

/** Keep Tab / Shift+Tab inside `container` (for modal dialogs). Returns true if it handled the key. */
export function trapTab(e: React.KeyboardEvent, container: HTMLElement | null): boolean {
  if (e.key !== 'Tab' || !container) return false;
  const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (!items.length) {
    e.preventDefault();
    return true;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === container)) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

/** A ref plus mount focus, the common case. */
export function useAutoFocusRef<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useFocusOnMount(ref);
  return ref;
}
