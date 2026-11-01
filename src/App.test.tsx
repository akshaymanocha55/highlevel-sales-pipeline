// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import type { ServerConfig } from './api/fakeServer';
import { StoreProvider } from './store/context';
import { firstIn, makeStore, settle, view } from './test/helpers';

async function setup(server: Partial<ServerConfig> = {}) {
  const { store, api } = await makeStore(400, server);
  const user = userEvent.setup();
  render(
    <StoreProvider store={store} server={api} bootMs={12}>
      <App simulateTeammates={false} />
    </StoreProvider>,
  );
  const grid = screen.getByRole('grid', { name: 'Deals' });
  return { store, api, user, grid };
}

const rowOf = (id: string) => document.getElementById(`row-${id}`)!;

describe('App', () => {
  it('renders the pipeline, the deal grid and a calm sync status', async () => {
    const { store, grid } = await setup();
    expect(screen.getByRole('heading', { name: 'Pipeline' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Stages' })).toBeInTheDocument();
    expect(grid).toHaveAttribute('aria-rowcount', String(store.viewIds.length + 1));
    expect(within(grid).getAllByRole('row').length).toBeGreaterThan(5);
    expect(screen.getByText('✓ All changes saved')).toBeInTheDocument();
    expect(grid).toHaveFocus();
  });

  it('moves the keyboard cursor with j/k and arrows', async () => {
    const { store, user, grid } = await setup();
    await user.keyboard('jj');
    expect(grid).toHaveAttribute('aria-activedescendant', `row-${store.viewIds[2]}`);
    await user.keyboard('{ArrowUp}');
    expect(grid).toHaveAttribute('aria-activedescendant', `row-${store.viewIds[1]}`);
    await user.keyboard('{End}');
    expect(store.focusIndex).toBe(store.viewIds.length - 1);
    await user.keyboard('{Home}');
    expect(store.focusIndex).toBe(0);
  });

  it('selects with Space, extends with Shift+↓ and clears with Escape', async () => {
    const { user } = await setup();
    await user.keyboard(' ');
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    await user.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
  });

  it('moves the focused deal with a number key, shows Saving, then Saved', async () => {
    const { store, user } = await setup({ minLatency: 150, maxLatency: 150 });
    const id = store.focusId!;
    await user.keyboard('7');
    expect(within(rowOf(id)).getByText('Lost')).toBeInTheDocument();
    expect(within(rowOf(id)).getByText('Saving…')).toBeInTheDocument();
    await act(() => settle(store));
    await waitFor(() => expect(within(rowOf(id)).getByText('✓ Saved')).toBeInTheDocument());
    expect(await screen.findByText('✓ All changes saved')).toBeInTheDocument();
  });

  it('moves every selected deal at once and offers undo', async () => {
    const { store, api, user } = await setup();
    await user.keyboard('{Control>}a{/Control}');
    expect(screen.getByText(`${store.viewIds.length} selected`)).toBeInTheDocument();
    const ids = [...store.viewIds];
    await user.keyboard('5');
    await act(() => settle(store));
    expect(ids.every((id) => api.getDeal(id)?.stage === 'negotiation')).toBe(true);
    expect(await screen.findByText(/^All [\d,]+ saved$/)).toBeInTheDocument();

    await user.keyboard('z');
    await act(() => settle(store));
    expect(ids.some((id) => api.getDeal(id)?.stage !== 'negotiation')).toBe(true);
  });

  it('never fails silently: shows the failure, lists it, and retries', async () => {
    const { store, api, user } = await setup({ offline: true });
    const id = firstIn(store, 'new');
    act(() => store.setFocus(store.viewIds.indexOf(id)));
    await user.keyboard('7');
    await act(() => settle(store));

    expect(within(rowOf(id)).getByText(/Not saved/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /1 not saved/ })).toBeInTheDocument();

    await user.keyboard('e');
    const drawer = screen.getByRole('dialog', { name: 'Unsaved changes' });
    expect(within(drawer).getByText('Unsaved changes (1)')).toBeInTheDocument();

    api.setConfig({ offline: false });
    await user.click(within(drawer).getByRole('button', { name: 'Retry all' }));
    await act(() => settle(store));
    expect(await within(drawer).findByText('Everything is saved.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a conflict with both sides and lets the user keep theirs', async () => {
    const { store, api, user } = await setup({ forceConflictNext: true });
    const id = firstIn(store, 'new');
    act(() => store.setFocus(store.viewIds.indexOf(id)));
    await user.keyboard('2');
    await act(() => settle(store));
    const row = within(rowOf(id));
    expect(row.getByText(/moved it$/)).toBeInTheDocument();
    await user.click(row.getByRole('button', { name: /Theirs/ }));
    expect(store.getDeal(id)?.stage).toBe(api.getDeal(id)?.stage);
  });

  it("holds back teammates' changes until the user presses R", async () => {
    const { store, api, user } = await setup();
    const before = [...store.viewIds];
    act(() => api.teammateEditNow(before[0], 'value'));
    act(() => api.teammateEditNow(before[1], 'owner'));
    await screen.findByText(/changed since this list was loaded/);
    expect(store.viewIds).toEqual(before);

    await user.keyboard('r');
    expect(screen.queryByText(/changed since this list was loaded/)).not.toBeInTheDocument();
  });

  it('explains an empty list and offers a way out', async () => {
    const { user } = await setup();
    await user.type(screen.getByRole('searchbox'), 'zzzz-nothing');
    expect(await screen.findByText('No deals match these filters')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear all filters' }));
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue(''));
    expect(screen.queryByText('No deals match these filters')).not.toBeInTheDocument();
  });

  it('explains why Won and Lost are empty with "needs attention only"', async () => {
    const { store, user } = await setup();
    await act(() => view(store, { stage: 'lost', attentionOnly: true }));
    expect(screen.getByText('Won and Lost deals never need attention')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all Lost deals' }));
    expect(store.filters.attentionOnly).toBe(false);
    await waitFor(() => expect(store.viewIds.length).toBeGreaterThan(0));
  });

  it('opens the stage picker with M and moves with arrows + Enter', async () => {
    const { store, user } = await setup();
    const id = firstIn(store, 'new');
    act(() => store.setFocus(store.viewIds.indexOf(id)));
    await user.keyboard('m');
    const menu = screen.getByRole('listbox', { name: /Move .* to stage/ });
    expect(menu).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(store.getDeal(id)?.stage).toBe('demo');
  });

  it('closes the stage picker with Escape without moving anything', async () => {
    const { store, user } = await setup();
    await user.keyboard('m');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(store.pending.size).toBe(0);
  });

  it('switches saved views with Shift+number', async () => {
    const { user } = await setup();
    await user.keyboard('{Shift>}[Digit1]{/Shift}');
    expect(screen.getByRole('button', { name: /^Today/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches the stage filter from the pipeline bar', async () => {
    const { store, user } = await setup();
    await user.click(screen.getByRole('button', { name: /^Won: / }));
    expect(store.filters.stage).toBe('won');
    expect(store.viewIds.every((id) => store.getDeal(id)?.stage === 'won')).toBe(true);
  });

  it('shows keyboard help with ?', async () => {
    const { user } = await setup();
    await user.keyboard('?');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lets reviewers change the simulation while the app runs', async () => {
    const { api, user } = await setup();
    await user.click(screen.getByRole('button', { name: /Simulation/ }));
    await user.click(screen.getByLabelText(/Offline/));
    expect(api.config.offline).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Calm' }));
    expect(api.config).toMatchObject({ offline: false, failureRate: 0 });
    expect(screen.getByText(/generated in 12 ms/)).toBeInTheDocument();
  });
});
