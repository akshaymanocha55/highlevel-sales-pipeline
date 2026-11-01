import { useEffect, useRef } from 'react';
import { PRESET_IDS } from '../domain/filters';
import { stageFromKey } from '../domain/stages';
import { focusGrid, focusSearch } from '../lib/dom';
import type { PipelineStore } from '../store/pipelineStore';

export interface ShortcutHandlers {
  openMoveMenu: () => void;
  openHelp: () => void;
  toggleUnsaved: () => void;
  toggleSimulation: () => void;
  /** Escape: close whatever is open; return true if something closed */
  closeTop: () => boolean;
}

/** Rough rows per screen, for PageUp/PageDown. */
const pageSize = () => Math.max(5, Math.floor((window.innerHeight - 380) / 52));

/** Text inputs and selects keep their own keys; buttons and checkboxes keep Space/Enter. */
function isOwnKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return true;
  if (tag === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox') return true;
  return (tag === 'BUTTON' || tag === 'INPUT') && (e.key === ' ' || e.key === 'Enter');
}

/**
 * Turn a key press into a store action. Returns true if the key was handled.
 * Exported separately so it can be tested without a DOM.
 */
export function handleShortcut(e: KeyboardEvent, store: PipelineStore, ui: ShortcutHandlers): boolean {
  const mod = e.metaKey || e.ctrlKey;

  // Shift+1..4: saved views. Uses `code` because Shift+1 types "!".
  if (e.shiftKey && !mod && /^Digit[1-4]$/.test(e.code)) {
    store.applyPreset(PRESET_IDS[Number(e.code.slice(5)) - 1]);
    return true;
  }
  if (mod && e.key.toLowerCase() === 'a') {
    store.selectAll();
    return true;
  }
  if (mod && e.key.toLowerCase() === 'z') {
    store.undo();
    return true;
  }
  if (mod || e.altKey) return false;

  const moveFocus = (to: number) => {
    const from = store.focusIndex;
    store.setFocus(to);
    if (e.shiftKey) store.selectRange(store.focusIndex, from);
  };

  switch (e.key) {
    case 'ArrowDown':
    case 'j':
    case 'J':
      moveFocus(store.focusIndex + 1);
      return true;
    case 'ArrowUp':
    case 'k':
    case 'K':
      moveFocus(store.focusIndex - 1);
      return true;
    case 'PageDown':
      moveFocus(store.focusIndex + pageSize());
      return true;
    case 'PageUp':
      moveFocus(store.focusIndex - pageSize());
      return true;
    case 'Home':
      moveFocus(0);
      return true;
    case 'End':
      moveFocus(store.viewIds.length - 1);
      return true;
    case ' ':
    case 'x': {
      const id = store.focusId;
      if (id) store.toggleSelect(id, store.focusIndex);
      return true;
    }
    case 'Escape':
      if (!ui.closeTop()) store.clearSelection();
      focusGrid();
      return true;
    case ']':
      store.step(store.targetIds(), 1);
      return true;
    case '[':
      store.step(store.targetIds(), -1);
      return true;
    case 'm':
      if (store.targetIds().length) ui.openMoveMenu();
      return true;
    case 'z':
      store.undo();
      return true;
    case 'r':
      store.refreshView();
      return true;
    case 'e':
      ui.toggleUnsaved();
      return true;
    case '/':
      focusSearch();
      return true;
    case '?':
      ui.openHelp();
      return true;
    case '`':
      ui.toggleSimulation();
      return true;
    case 'y': {
      const id = store.focusId;
      if (id) store.retry([id]);
      return true;
    }
    case 'n': {
      const id = store.focusId;
      if (id) store.discard([id]);
      return true;
    }
  }

  const stage = e.shiftKey ? null : stageFromKey(e.key);
  if (stage) {
    store.move(store.targetIds(), stage);
    return true;
  }
  return false;
}

/** Global keyboard shortcuts. Disabled while a modal (move menu, help) handles its own keys. */
export function useShortcuts(store: PipelineStore, ui: ShortcutHandlers, enabled: boolean) {
  // read the latest handlers without re-binding the listener on every render
  const uiRef = useRef(ui);
  useEffect(() => {
    uiRef.current = ui;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isOwnKey(e)) return;
      if (handleShortcut(e, store, uiRef.current)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, enabled]);
}
