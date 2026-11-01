import { stageKey } from '../../domain/stages';
import { STAGES } from '../../domain/types';
import { cx } from '../../lib/dom';
import { count } from '../../lib/format';
import { useStore } from '../../store/context';
import { useTopic } from '../../store/hooks';
import { Button, Kbd, StageChip } from '../components';

/** Bulk actions for the selection. With nothing selected, offers "Select all" and a keyboard tip. */
export function SelectionBar() {
  const store = useStore();
  useTopic('selection');
  useTopic('view');
  const n = store.selected.size;
  const total = store.viewIds.length;

  if (!n) {
    return (
      <div className="selbar">
        <Button variant="link" onClick={() => store.selectAll()} shortcut="⌘A" disabled={total === 0}>
          Select all {count(total)}
        </Button>
        <span className="sep" />
        <span className="muted tip">
          <Kbd>Space</Kbd> selects one, <Kbd>Shift</Kbd>+<Kbd>↓</Kbd> extends, then a number key moves them.{' '}
          <Kbd>?</Kbd> shows all shortcuts.
        </span>
      </div>
    );
  }

  return (
    <div className={cx('selbar', 'on')} role="toolbar" aria-label="Bulk actions">
      <strong>{count(n)} selected</strong>
      {n < total && (
        <Button variant="link" onClick={() => store.selectAll()} shortcut="⌘A">
          Select all {count(total)}
        </Button>
      )}
      <span className="sep" />
      <span className="muted">Move to</span>
      {STAGES.map((s) => (
        <StageChip key={s} stage={s} onClick={() => store.move(store.targetIds(), s)}>
          <Kbd>{stageKey(s)}</Kbd>
        </StageChip>
      ))}
      <span className="sep" />
      <Button variant="link" onClick={() => store.clearSelection()} shortcut="Esc">
        Clear
      </Button>
    </div>
  );
}
