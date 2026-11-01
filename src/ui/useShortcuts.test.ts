// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { firstIn, makeStore, view } from '../test/helpers';
import { handleShortcut, type ShortcutHandlers } from './useShortcuts';

async function setup() {
  const { store } = await makeStore(300);
  const ui: ShortcutHandlers = {
    openMoveMenu: vi.fn(),
    openHelp: vi.fn(),
    toggleUnsaved: vi.fn(),
    toggleSimulation: vi.fn(),
    closeTop: vi.fn(() => false),
  };
  const press = (key: string, init: KeyboardEventInit = {}) =>
    handleShortcut(new KeyboardEvent('keydown', { key, ...init }), store, ui);
  return { store, ui, press };
}

describe('handleShortcut', () => {
  it('pages, and extends the selection when Shift is held', async () => {
    const { store, press } = await setup();
    press('PageDown');
    expect(store.focusIndex).toBeGreaterThanOrEqual(5);
    press('PageUp');
    expect(store.focusIndex).toBe(0);
    press('J', { shiftKey: true });
    press('J', { shiftKey: true });
    expect(store.selected.size).toBe(3);
    press('K', { shiftKey: true });
    expect(store.focusIndex).toBe(1);
  });

  it('toggles selection with x', async () => {
    const { store, press } = await setup();
    press('x');
    expect(store.selected.has(store.viewIds[0])).toBe(true);
    press('x');
    expect(store.selected.size).toBe(0);
  });

  it('steps stages with ] and [', async () => {
    const { store, press } = await setup();
    const id = firstIn(store, 'contacted');
    store.setFocus(store.viewIds.indexOf(id));
    press(']');
    expect(store.getDeal(id)?.stage).toBe('demo');
    press('[');
    press('[');
    expect(store.getDeal(id)?.stage).toBe('new');
  });

  it('opens panels and dialogs', async () => {
    const { ui, press } = await setup();
    press('m');
    press('?');
    press('e');
    press('`');
    expect(ui.openMoveMenu).toHaveBeenCalled();
    expect(ui.openHelp).toHaveBeenCalled();
    expect(ui.toggleUnsaved).toHaveBeenCalled();
    expect(ui.toggleSimulation).toHaveBeenCalled();
  });

  it('Escape closes the top panel first, and only then clears the selection', async () => {
    const { store, ui, press } = await setup();
    store.toggleSelect(store.viewIds[0]);
    vi.mocked(ui.closeTop).mockReturnValueOnce(true);
    press('Escape');
    expect(store.selected.size).toBe(1);
    press('Escape');
    expect(store.selected.size).toBe(0);
  });

  it('focuses search with /', async () => {
    const { press } = await setup();
    const input = document.createElement('input');
    input.id = 'search';
    document.body.append(input);
    press('/');
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it('undoes with z and Ctrl/Cmd+Z', async () => {
    const { store, press } = await setup();
    const spy = vi.spyOn(store, 'undo');
    press('z');
    press('z', { ctrlKey: true });
    press('z', { metaKey: true });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('retries (y) and discards (n) the focused row', async () => {
    const { store, press } = await setup();
    const retry = vi.spyOn(store, 'retry');
    const discard = vi.spyOn(store, 'discard');
    press('y');
    press('n');
    expect(retry).toHaveBeenCalledWith([store.focusId]);
    expect(discard).toHaveBeenCalledWith([store.focusId]);
  });

  it('ignores keys it does not own', async () => {
    const { store, press } = await setup();
    expect(press('q')).toBe(false);
    expect(press('7', { altKey: true })).toBe(false);
    expect(press('c', { ctrlKey: true })).toBe(false);
    expect(press('8')).toBe(false);
    expect(store.pending.size).toBe(0);
  });

  it('does nothing harmful on an empty list', async () => {
    const { store, ui, press } = await setup();
    await view(store, { search: 'no-such-deal' });
    for (const k of [' ', 'm', 'y', 'n', '7', ']']) expect(press(k)).toBe(true);
    expect(ui.openMoveMenu).not.toHaveBeenCalled();
    expect(store.pending.size).toBe(0);
  });
});
