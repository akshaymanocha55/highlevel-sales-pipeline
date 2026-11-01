import { useEffect, useRef } from 'react';
import { count } from '../../lib/format';
import { useStore } from '../../store/context';
import { useTopic } from '../../store/hooks';

/** Header checkbox: empty, partly selected (indeterminate) or all selected. Toggles the whole view. */
export function SelectAllCheckbox() {
  const store = useStore();
  useTopic('selection');
  useTopic('view');
  const total = store.viewIds.length;
  const n = store.selected.size;
  const all = total > 0 && n >= total;
  const some = n > 0 && !all;
  const ref = useRef<HTMLInputElement>(null);

  // "indeterminate" has no HTML attribute; it can only be set from JS
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);

  return (
    <input
      ref={ref}
      type="checkbox"
      tabIndex={-1}
      disabled={total === 0}
      checked={all}
      aria-checked={some ? 'mixed' : all}
      aria-label={all ? 'Clear selection' : `Select all ${count(total)} deals in this view`}
      onChange={() => {
        if (all) store.clearSelection();
        else store.selectAll();
      }}
    />
  );
}
