import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { GRID_ID } from '../../lib/dom';
import { useStore } from '../../store/context';
import { MOBILE_QUERY, useMediaQuery, useTopic } from '../../store/hooks';
import { DealRow } from './DealRow';
import { EmptyState } from './EmptyState';
import { SelectAllCheckbox } from './SelectAllCheckbox';

export const ROW_HEIGHT = 52;
export const ROW_HEIGHT_MOBILE = 64;

const COLUMNS = ['Deal', 'Stage', 'Sync', 'Value', 'Owner', 'Idle', 'Close', 'Needs attention'];
const NUMERIC = new Set(['Value', 'Idle']);

/**
 * The deal grid. Only the rows on screen (plus a small buffer) are in the DOM.
 * Keyboard focus stays on the grid; the active row is announced via aria-activedescendant.
 */
export function DealTable({ onOpenMoveMenu }: { onOpenMoveMenu: () => void }) {
  const store = useStore();
  useTopic('focus');
  useTopic('meta'); // loading state
  const ids = store.viewIds;
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowHeight = useMediaQuery(MOBILE_QUERY) ? ROW_HEIGHT_MOBILE : ROW_HEIGHT;

  // this rule is about the React Compiler, which this project doesn't use
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    // lets the first paint (and jsdom tests) render rows before the element is measured
    initialRect: { width: 1200, height: 800 },
  });

  useEffect(() => virtualizer.measure(), [rowHeight, virtualizer]);

  // infinite scroll: fetch details for the rows on screen (+ the next page), 20 at a time
  const items = virtualizer.getVirtualItems();
  const firstVisible = items.length ? items[0].index : 0;
  const lastVisible = items.length ? items[items.length - 1].index : 0;
  const viewVersion = useTopic('view');
  useEffect(() => {
    store.loadRange(firstVisible, lastVisible + store.pageSize);
  }, [store, firstVisible, lastVisible, viewVersion]);

  // keep the keyboard cursor on screen
  useEffect(
    () =>
      store.subscribe('focus', () => {
        if (store.viewIds.length) virtualizer.scrollToIndex(store.focusIndex, { align: 'auto' });
      }),
    [store, virtualizer],
  );

  const focusId = store.focusId;

  return (
    <div
      ref={scrollRef}
      id={GRID_ID}
      className="grid"
      role="grid"
      tabIndex={0}
      aria-label="Deals"
      aria-rowcount={ids.length + 1}
      aria-multiselectable
      aria-activedescendant={focusId ? `row-${focusId}` : undefined}
    >
      <div className="row head" role="row" aria-rowindex={1}>
        <div role="columnheader" className="c-check">
          <SelectAllCheckbox />
        </div>
        {COLUMNS.map((c) => (
          <div key={c} role="columnheader" className={NUMERIC.has(c) ? 'num' : undefined}>
            {c}
          </div>
        ))}
      </div>

      {ids.length === 0 ? (
        store.viewLoading ? (
          <div className="grid-empty" role="status">
            Loading deals…
          </div>
        ) : (
          <EmptyState />
        )
      ) : (
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {items.map((v) => (
            <DealRow
              // a row whose page hasn't arrived has no id yet: key it by position until it does
              key={ids[v.index] || `pending-${v.index}`}
              id={ids[v.index]}
              index={v.index}
              top={v.start}
              onOpenMoveMenu={onOpenMoveMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}
