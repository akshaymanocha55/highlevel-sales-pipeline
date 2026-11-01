// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import type { ServerConfig } from '../api/fakeServer';
import { StoreProvider } from '../store/context';
import { createServer, createStore } from '../store/createAppStore';
import { firstIn, makeStore, settle } from '../test/helpers';

async function setup(server: Partial<ServerConfig> = {}) {
  const { store, api } = await makeStore(300, server);
  const user = userEvent.setup();
  render(
    <StoreProvider store={store} server={api}>
      <App simulateTeammates={false} />
    </StoreProvider>,
  );
  return { store, api, user };
}

const row = (id: string) => within(document.getElementById(`row-${id}`)!);

describe('mouse and touch', () => {
  it('clicking a row focuses it; Cmd/Ctrl-click and Shift-click select', async () => {
    const { store, user } = await setup();
    const [a, , c] = store.viewIds;
    await user.click(row(c).getByText(store.getDeal(c)!.company));
    expect(store.focusId).toBe(c);

    await user.keyboard('{Control>}');
    await user.click(row(a).getByText(store.getDeal(a)!.company));
    await user.keyboard('{/Control}');
    expect(store.selected.has(a)).toBe(true);

    await user.keyboard('{Shift>}');
    await user.click(row(c).getByText(store.getDeal(c)!.company));
    await user.keyboard('{/Shift}');
    expect(store.selected.size).toBe(3);
  });

  it('checkboxes select rows, and Shift-click on a checkbox selects a range', async () => {
    const { store, user } = await setup();
    const [a, b, c] = store.viewIds;
    await user.click(row(a).getByRole('checkbox'));
    expect(store.selected.has(a)).toBe(true);
    fireEvent.click(row(c).getByRole('checkbox'), { shiftKey: true });
    expect([a, b, c].every((id) => store.selected.has(id))).toBe(true);
  });

  it('offers "Select all" before anything is selected, from the bar and the header checkbox', async () => {
    const { store, user } = await setup();
    const total = store.viewIds.length;
    await user.click(screen.getByRole('button', { name: new RegExp(`^Select all ${total}`) }));
    expect(store.selected.size).toBe(total);

    const header = screen.getByRole('checkbox', { name: 'Clear selection' });
    expect(header).toBeChecked();
    await user.click(header);
    expect(store.selected.size).toBe(0);

    await user.click(screen.getByRole('checkbox', { name: `Select all ${total} deals in this view` }));
    expect(store.selected.size).toBe(total);
    await user.click(screen.getByRole('checkbox', { name: 'Clear selection' }));

    // one row selected: the header shows "partly selected"
    await user.click(within(document.getElementById(`row-${store.viewIds[0]}`)!).getByRole('checkbox'));
    const partial = screen.getByRole('checkbox', { name: /^Select all/ });
    expect(partial).toHaveAttribute('aria-checked', 'mixed');
    expect((partial as HTMLInputElement).indeterminate).toBe(true);
  });

  it('the selection bar moves, selects all and clears', async () => {
    const { store, user } = await setup();
    const id = firstIn(store, 'new');
    await user.click(row(id).getByRole('checkbox'));
    const bar = within(screen.getByRole('toolbar', { name: 'Bulk actions' }));
    await user.click(bar.getByRole('button', { name: /Select all/ }));
    expect(store.selected.size).toBe(store.viewIds.length);
    await user.click(bar.getByRole('button', { name: /Clear/ }));
    expect(store.selected.size).toBe(0);

    await user.click(row(id).getByRole('checkbox'));
    await user.click(
      within(screen.getByRole('toolbar', { name: 'Bulk actions' })).getByRole('button', { name: /Contacted/ }),
    );
    expect(store.getDeal(id)?.stage).toBe('contacted');
  });

  it('tapping a stage chip opens the picker for that deal; number keys pick', async () => {
    const { store, user } = await setup();
    const id = firstIn(store, 'new');
    await user.click(row(id).getByRole('button', { name: /Change stage/ }));
    expect(screen.getByRole('listbox')).toHaveAccessibleName(`Move ${store.getDeal(id)!.company} to stage`);
    await user.keyboard('4');
    expect(store.getDeal(id)?.stage).toBe('proposal');
  });

  it('the picker can be used with the mouse and closed by clicking outside', async () => {
    const { store, user } = await setup();
    const id = firstIn(store, 'new');
    await user.click(row(id).getByRole('button', { name: /Change stage/ }));
    await user.click(screen.getByRole('option', { name: /Won/ }));
    expect(store.getDeal(id)?.stage).toBe('won');

    await user.click(row(id).getByRole('button', { name: /Change stage/ }));
    await user.click(document.querySelector('.overlay')!);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('row buttons retry and discard failed saves', async () => {
    const { store, api, user } = await setup({ offline: true });
    const [a, b] = store.viewIds.filter((id) => store.getDeal(id)?.stage === 'new');
    act(() => {
      store.move([a], 'won');
      store.move([b], 'won');
    });
    await act(() => settle(store));
    await user.click(row(b).getByRole('button', { name: /Discard/ }));
    expect(store.getPending(b)).toBeUndefined();

    api.setConfig({ offline: false });
    await user.click(row(a).getByRole('button', { name: /Retry/ }));
    await act(() => settle(store));
    expect(api.getDeal(a)?.stage).toBe('won');
  });

  it('conflict rows offer "Mine"; the drawer handles items one by one', async () => {
    const { store, api, user } = await setup({ forceConflictNext: true });
    const id = firstIn(store, 'new');
    act(() => {
      store.move([id], 'demo');
    });
    await act(() => settle(store));
    await user.click(await screen.findByRole('button', { name: /conflict/ }));
    const drawer = within(screen.getByRole('dialog', { name: 'Unsaved changes' }));
    expect(drawer.getByText(/You chose Demo Done/)).toBeInTheDocument();
    await user.click(drawer.getByRole('button', { name: 'Keep mine' }));
    await act(() => settle(store));
    expect(api.getDeal(id)?.stage).toBe('demo');
    await user.click(drawer.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('the drawer can discard everything at once and retry single items', async () => {
    const { store, api, user } = await setup({ offline: true });
    const ids = store.viewIds.filter((id) => store.getDeal(id)?.stage === 'new').slice(0, 3);
    act(() => {
      store.move(ids, 'lost');
    });
    await act(() => settle(store));
    await user.keyboard('e');
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getAllByText(/failed \(You are offline\)/)).toHaveLength(3);
    api.setConfig({ offline: false });
    await user.click(drawer.getAllByRole('button', { name: 'Retry' })[0]);
    await act(() => settle(store));
    await user.click(drawer.getAllByRole('button', { name: 'Discard' })[0]);
    await user.click(drawer.getByRole('button', { name: 'Discard all' }));
    expect(store.syncSummary()).toEqual({ saving: 0, failed: 0, conflicts: 0 });
  });

  it('job cards retry failures, undo, and dismiss', async () => {
    const { store, api, user } = await setup({ offline: true });
    const ids = store.viewIds.filter((id) => store.getDeal(id)?.stage === 'new').slice(0, 2);
    act(() => {
      store.move(ids, 'won');
    });
    await act(() => settle(store));
    expect(await screen.findByText('0 saved, 2 not saved')).toBeInTheDocument();
    api.setConfig({ offline: false });
    await user.click(screen.getByRole('button', { name: 'Retry failed' }));
    await act(() => settle(store));
    expect(ids.every((id) => api.getDeal(id)?.stage === 'won')).toBe(true);
    const dismissButtons = () => screen.queryAllByRole('button', { name: 'Dismiss' });
    for (let i = 0; i < 5 && dismissButtons().length; i++) await user.click(dismissButtons()[0]);
    expect(dismissButtons()).toHaveLength(0);

    act(() => {
      store.move([ids[0]], 'lost');
    });
    await act(() => settle(store));
    await user.click(await screen.findByRole('button', { name: /Undo/ }));
    await act(() => settle(store));
    expect(api.getDeal(ids[0])?.stage).toBe('won');
  });

  it('filter dropdowns and the attention checkbox change the view', async () => {
    const { store, user } = await setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Owner' }), 'Rahul Verma');
    expect(store.viewIds.every((id) => store.getDeal(id)?.owner === 'Rahul Verma')).toBe(true);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Idle' }), '30');
    expect(store.filters.idle).toBe(30);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'company');
    expect(store.filters.sort).toBe('company');
    await user.click(screen.getByRole('checkbox', { name: 'Needs attention only' }));
    expect(store.filters.attentionOnly).toBe(true);
    await user.click(screen.getByRole('button', { name: /^Whole team/ }));
    expect(store.filters.preset).toBe('team');
    await user.click(screen.getByRole('button', { name: /^Open deals/ }));
    expect(store.filters.stage).toBe('open');
  });

  it('search returns focus to the list with Enter', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('searchbox'));
    await user.keyboard('acme{Enter}');
    expect(screen.getByRole('grid')).toHaveFocus();
  });

  it('the banner button applies held-back changes', async () => {
    const { store, api, user } = await setup();
    act(() => {
      api.teammateEditNow(store.viewIds[0], 'value');
    });
    await user.click(await screen.findByRole('button', { name: /Show changes/ }));
    expect(store.stale.size).toBe(0);
  });

  it('the simulation panel changes latency, failures, teammates and can trigger edits', async () => {
    const { store, api, user } = await setup();
    await user.keyboard('`');
    const panel = within(screen.getByRole('region', { name: 'Simulation controls' }));
    fireEvent.change(panel.getByLabelText('Minimum latency'), { target: { value: '1000' } });
    fireEvent.change(panel.getByLabelText('Maximum latency'), { target: { value: '4000' } });
    fireEvent.change(panel.getByLabelText(/Failed requests/), { target: { value: '40' } });
    fireEvent.change(panel.getByLabelText(/Teammate edits/), { target: { value: '7' } });
    await user.click(panel.getByLabelText(/Next save hits a conflict/));
    expect(api.config).toMatchObject({
      minLatency: 1000,
      maxLatency: 4000,
      failureRate: 0.4,
      teammateRate: 7,
      forceConflictNext: true,
    });

    const focused = store.focusId!;
    await user.click(panel.getByRole('button', { name: 'Teammate moves focused deal' }));
    await user.click(panel.getByRole('button', { name: 'Teammate edits its value' }));
    expect(store.getServerDeal(focused)!.version).toBe(3);

    await user.click(panel.getByRole('button', { name: 'Chaos' }));
    expect(api.config.failureRate).toBe(0.5);
    await user.click(panel.getByRole('button', { name: 'Brief defaults' }));
    expect(api.config.failureRate).toBe(0.1);
    await user.click(panel.getByRole('button', { name: 'Close simulation controls' }));
    expect(screen.queryByRole('region', { name: 'Simulation controls' })).not.toBeInTheDocument();
  });

  it('warns before leaving with unsaved changes', async () => {
    const { store } = await setup({ minLatency: 500, maxLatency: 500 });
    act(() => {
      store.move([store.viewIds[0]], store.getDeal(store.viewIds[0])!.stage === 'won' ? 'lost' : 'won');
    });
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});

describe('createServer / createStore', () => {
  it('builds a server with generated deals and a store that loads from it', async () => {
    const { server, bootMs } = createServer({ count: 100, config: { teammateRate: 0, readLatency: 0 } });
    expect(server.getDeal('D-00001')).toBeDefined();
    expect(bootMs).toBeGreaterThanOrEqual(0);
    const store = createStore(server, 'in-process', { me: 'Rahul Verma' });
    await store.whenLoaded();
    expect(store.viewIds.every((id) => store.stageOf(id))).toBe(true);
    expect(createStore(server, 'http').api.constructor.name).toBe('HttpApi');
  });
});
