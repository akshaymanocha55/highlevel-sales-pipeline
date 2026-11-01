import { useState } from 'react';
import { stageFromKey, stageKey } from '../../domain/stages';
import { STAGES, type Stage } from '../../domain/types';
import { cx } from '../../lib/dom';
import { count } from '../../lib/format';
import { useStore } from '../../store/context';
import { Dialog, Kbd, StageChip } from '../components';

/** Keyboard-first stage picker (M). Arrows + Enter, or a number key straight to a stage. */
export function MoveMenu({ onClose }: { onClose: () => void }) {
  const store = useStore();
  // the targets are fixed when the menu opens, even if the selection changes behind it
  const [ids] = useState(() => store.targetIds());
  const current = ids.length === 1 ? store.getDeal(ids[0])?.stage : undefined;
  const [active, setActive] = useState(() => (current ? STAGES.indexOf(current) : 0));

  const name = ids.length === 1 ? (store.getDeal(ids[0])?.company ?? '1 deal') : `${count(ids.length)} deals`;
  const label = `Move ${name} to stage`;

  const choose = (s: Stage) => {
    store.move(ids, s);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const byNumber = stageFromKey(e.key);
    if (e.key === 'ArrowDown' || e.key === 'j') setActive((a) => (a + 1) % STAGES.length);
    else if (e.key === 'ArrowUp' || e.key === 'k') setActive((a) => (a - 1 + STAGES.length) % STAGES.length);
    else if (e.key === 'Enter') choose(STAGES[active]);
    else if (byNumber) choose(byNumber);
    else return;
    e.preventDefault();
  };

  return (
    <Dialog label={label} onClose={onClose} className="menu">
      <div className="menu-title" aria-hidden>
        Move {name} to…
      </div>
      <div
        role="listbox"
        aria-label={label}
        aria-activedescendant={`stage-opt-${STAGES[active]}`}
        tabIndex={-1}
        data-autofocus
        onKeyDown={onKeyDown}
      >
        {STAGES.map((s, i) => (
          <div
            key={s}
            id={`stage-opt-${s}`}
            role="option"
            aria-selected={i === active}
            className={cx('opt', i === active && 'active')}
            onMouseEnter={() => setActive(i)}
            onClick={() => choose(s)}
          >
            <StageChip stage={s} />
            {s === current && <span className="muted small">current</span>}
            <Kbd>{stageKey(s)}</Kbd>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
