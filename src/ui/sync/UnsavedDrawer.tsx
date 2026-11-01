import { STAGE_LABEL } from '../../domain/types';
import { count, firstName } from '../../lib/format';
import { useStore } from '../../store/context';
import { useTopic } from '../../store/hooks';
import type { PendingMove } from '../../store/pipelineStore';
import { Button, Panel } from '../components';

const MAX_LISTED = 200;

/** Everything that isn't saved, in one place, even if it's filtered out of the list. */
export function UnsavedDrawer({ onClose }: { onClose: () => void }) {
  const store = useStore();
  useTopic('meta');
  const items = [...store.pending.values()].filter((p) => p.status === 'failed' || p.status === 'conflict');
  const ids = items.map((p) => p.id);
  const listed = items.slice(0, MAX_LISTED);

  return (
    <Panel
      title={`Unsaved changes (${count(items.length)})`}
      label="Unsaved changes"
      className="drawer"
      onClose={onClose}
    >
      {items.length === 0 ? (
        <p className="muted pad">Everything is saved.</p>
      ) : (
        <>
          <div className="drawer-actions">
            <Button variant="primary" onClick={() => store.retry(ids)}>
              Retry all
            </Button>
            <Button onClick={() => store.discard(ids)}>Discard all</Button>
          </div>
          <ul className="failed-list">
            {listed.map((p) => (
              <UnsavedItem key={p.id} p={p} />
            ))}
          </ul>
          {items.length > listed.length && (
            <p className="muted pad">And {count(items.length - listed.length)} more. "Retry all" covers them too.</p>
          )}
        </>
      )}
    </Panel>
  );
}

function UnsavedItem({ p }: { p: PendingMove }) {
  const store = useStore();
  const d = store.getServerDeal(p.id);
  if (!d) return null;
  const theirs = p.status === 'conflict' ? p.theirs : undefined;
  return (
    <li>
      <div>
        <strong>{d.company}</strong> <span className="muted">{d.id}</span>
        <div className="muted small">
          {theirs
            ? `You chose ${STAGE_LABEL[p.toStage]}. ${firstName(theirs.by)} moved it to ${STAGE_LABEL[theirs.stage]}.`
            : `Move to ${STAGE_LABEL[p.toStage]} failed (${p.error ?? 'error'}). Still in ${STAGE_LABEL[d.stage]}.`}
        </div>
      </div>
      <div className="row-actions">
        <Button onClick={() => store.retry([p.id])}>{theirs ? 'Keep mine' : 'Retry'}</Button>
        <Button onClick={() => store.discard([p.id])}>{theirs ? 'Keep theirs' : 'Discard'}</Button>
      </div>
    </li>
  );
}
