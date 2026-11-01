import { count } from '../../lib/format';
import { useStore } from '../../store/context';
import { useTopic } from '../../store/hooks';
import { Button, Spinner } from '../components';

/** Header status: never shows "saved" while anything is unsaved. */
export function SyncIndicator({ onOpen }: { onOpen: () => void }) {
  const store = useStore();
  useTopic('meta');
  const { saving, failed, conflicts } = store.syncSummary();

  if (failed || conflicts) {
    const parts = [
      failed ? `${count(failed)} not saved` : '',
      conflicts ? `${count(conflicts)} conflict${conflicts > 1 ? 's' : ''}` : '',
      saving ? `saving ${count(saving)}` : '',
    ].filter(Boolean);
    return (
      <Button className="sync-ind bad" onClick={onOpen} shortcut="E">
        ⚠ {parts.join(', ')}. Review
      </Button>
    );
  }
  return (
    <span className={saving ? 'sync-ind busy' : 'sync-ind ok'} role="status">
      {saving ? (
        <>
          <Spinner /> Saving {count(saving)}…
        </>
      ) : (
        '✓ All changes saved'
      )}
    </span>
  );
}
