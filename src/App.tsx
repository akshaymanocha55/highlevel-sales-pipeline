import { useEffect, useState } from 'react';
import { focusGrid } from './lib/dom';
import { IconButton } from './ui/components';
import { useServer, useStore } from './store/context';
import { HelpDialog } from './ui/overlays/HelpDialog';
import { MoveMenu } from './ui/overlays/MoveMenu';
import { SimulationPanel } from './ui/overlays/SimulationPanel';
import { ActivityStack } from './ui/sync/ActivityStack';
import { LiveRegion } from './ui/sync/LiveRegion';
import { SyncIndicator } from './ui/sync/SyncIndicator';
import { UnsavedDrawer } from './ui/sync/UnsavedDrawer';
import { DealTable } from './ui/table/DealTable';
import { FilterBar } from './ui/toolbar/FilterBar';
import { PipelineBar } from './ui/toolbar/PipelineBar';
import { Presets } from './ui/toolbar/Presets';
import { SelectionBar } from './ui/toolbar/SelectionBar';
import { UpdatesBanner } from './ui/toolbar/UpdatesBanner';
import { useShortcuts } from './ui/useShortcuts';

type Modal = null | 'move' | 'help';

export function App({ simulateTeammates = true }: { simulateTeammates?: boolean }) {
  const store = useStore();
  const server = useServer();
  const [modal, setModal] = useState<Modal>(null);
  const [unsavedOpen, setUnsavedOpen] = useState(false);
  const [simOpen, setSimOpen] = useState(false);

  // the fake websocket: teammates editing deals
  useEffect(() => {
    if (!simulateTeammates) return;
    server.startTeammates();
    return () => server.stopTeammates();
  }, [server, simulateTeammates]);

  useEffect(() => focusGrid(), []);

  // warn before closing the tab with unsaved work
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (store.pending.size) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [store]);

  useShortcuts(
    store,
    {
      openMoveMenu: () => setModal('move'),
      openHelp: () => setModal('help'),
      toggleUnsaved: () => setUnsavedOpen((o) => !o),
      toggleSimulation: () => setSimOpen((o) => !o),
      closeTop: () => {
        if (unsavedOpen) setUnsavedOpen(false);
        else if (simOpen) setSimOpen(false);
        else return false;
        return true;
      },
    },
    modal === null,
  );

  // dialogs hand focus back to where it was when they close
  const closeModal = () => setModal(null);

  return (
    <div className="app">
      <header className="top">
        <h1>Pipeline</h1>
        <Presets />
        <div className="spacer" />
        <SyncIndicator onOpen={() => setUnsavedOpen(true)} />
        <span className="signed-in">Signed in as {store.me}</span>
        <IconButton className="help-btn" icon="?" label="Keyboard shortcuts" onClick={() => setModal('help')} />
      </header>
      <PipelineBar />
      <main className="workspace">
        <FilterBar />
        <UpdatesBanner />
        <SelectionBar />
        <DealTable onOpenMoveMenu={() => setModal('move')} />
      </main>

      <ActivityStack />
      {unsavedOpen && <UnsavedDrawer onClose={() => setUnsavedOpen(false)} />}
      <SimulationPanel open={simOpen} onToggle={() => setSimOpen((o) => !o)} />
      {modal === 'move' && <MoveMenu onClose={closeModal} />}
      {modal === 'help' && <HelpDialog onClose={closeModal} />}
      <LiveRegion />
    </div>
  );
}
