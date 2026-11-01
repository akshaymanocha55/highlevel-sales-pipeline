import { STAGE_LABEL } from '../../domain/types';
import { firstName } from '../../lib/format';
import { useStore } from '../../store/context';
import { MAX_ATTEMPTS, type PendingMove } from '../../store/pipelineStore';
import { Button, Spinner } from '../components';

interface Props {
  id: string;
  pending: PendingMove | undefined;
  remoteSummary?: string;
  leaving: boolean;
  justSaved: boolean;
}

/** The row's save status. Problems always win over informational notes. */
export function SyncCell({ id, pending: p, remoteSummary, leaving, justSaved }: Props) {
  const store = useStore();
  const act = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  if (p?.status === 'saving' || p?.status === 'retrying') {
    return (
      <span className="sync saving">
        <Spinner />
        {p.status === 'saving' ? 'Saving…' : `Retrying (${p.attempts + 1}/${MAX_ATTEMPTS})…`}
      </span>
    );
  }
  if (p?.status === 'failed') {
    return (
      <span className="sync failed">
        <span className="sync-text" title={p.error}>
          ⚠ Not saved: {STAGE_LABEL[p.toStage]}
        </span>
        <Button tabIndex={-1} shortcut="Y" onClick={act(() => store.retry([id]))}>
          Retry
        </Button>
        <Button tabIndex={-1} shortcut="N" onClick={act(() => store.discard([id]))}>
          Discard
        </Button>
      </span>
    );
  }
  if (p?.status === 'conflict' && p.theirs) {
    return (
      <span className="sync conflict">
        {/* the Stage column already shows their stage; the full sentence is in the tooltip */}
        <span
          className="sync-text"
          title={`${p.theirs.by} moved it to ${STAGE_LABEL[p.theirs.stage]}. You chose ${STAGE_LABEL[p.toStage]}.`}
        >
          ⚠ {firstName(p.theirs.by)} moved it
        </span>
        <Button
          tabIndex={-1}
          shortcut="Y"
          title={`Move to ${STAGE_LABEL[p.toStage]} anyway`}
          onClick={act(() => store.keepMine([id]))}
        >
          Mine
        </Button>
        <Button tabIndex={-1} shortcut="N" onClick={act(() => store.discard([id]))}>
          Theirs
        </Button>
      </span>
    );
  }
  if (remoteSummary) return <span className="sync remote">↻ {remoteSummary}</span>;
  if (leaving) return <span className="sync remote">Leaves this view on refresh</span>;
  if (justSaved) return <span className="sync saved">✓ Saved</span>;
  return null;
}
