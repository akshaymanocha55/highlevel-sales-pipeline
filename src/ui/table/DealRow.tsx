import { memo } from 'react';
import { attentionOf, idleDays, REASON_LABEL } from '../../domain/attention';
import { STAGE_LABEL } from '../../domain/types';
import { cx, focusGrid } from '../../lib/dom';
import { money, relDays } from '../../lib/format';
import { useStore } from '../../store/context';
import { useExpiry, useIsFocused, useIsSelected, useRowVersion } from '../../store/hooks';
import { Avatar, StageChip } from '../components';
import { SyncCell } from './SyncCell';

/** how long the "teammate changed this" and "✓ Saved" notes stay */
export const REMOTE_NOTE_MS = 4000;
export const SAVED_NOTE_MS = 2500;

interface Props {
  id: string;
  index: number;
  top: number;
  onOpenMoveMenu: () => void;
}

/**
 * One deal. Subscribes to its own deal, selection and focus only, so a change elsewhere
 * in the 50k-deal pipeline never re-renders it.
 */
export const DealRow = memo(function DealRow({ id, index, top, onOpenMoveMenu }: Props) {
  const store = useStore();
  useRowVersion(id);
  const selected = useIsSelected(id);
  const focused = useIsFocused(id);

  const now = store.now();
  const flash = store.remoteFlash.get(id);
  const remote = flash && now - flash.at < REMOTE_NOTE_MS ? flash : undefined;
  const savedTs = store.savedAt.get(id);
  const justSaved = savedTs !== undefined && now - savedTs < SAVED_NOTE_MS;
  useExpiry(Math.max(remote ? remote.at + REMOTE_NOTE_MS : 0, justSaved ? savedTs + SAVED_NOTE_MS : 0));

  const deal = store.getDeal(id);
  if (!deal) return <SkeletonRow id={id} index={index} top={top} focused={focused} selected={selected} />;

  const p = store.getPending(id);
  const saving = p?.status === 'saving' || p?.status === 'retrying';
  const problem = p?.status === 'failed' || p?.status === 'conflict';
  const att = attentionOf(deal, now);
  // a teammate's change took it out of this view; it stays put until the user refreshes
  const leaving = !store.matches(deal, now);
  // on phones the sync note replaces the owner, so the row needs to know whether it has one
  const hasSync = Boolean(p) || Boolean(remote) || leaving || justSaved;
  const isMe = deal.owner === store.me;

  const onClick = (e: React.MouseEvent) => {
    if (e.shiftKey) store.selectRange(index);
    else if (e.metaKey || e.ctrlKey) store.toggleSelect(id, index);
    store.setFocus(index);
    focusGrid();
  };

  return (
    <div
      id={`row-${id}`}
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      className={cx(
        'row',
        selected && 'selected',
        focused && 'focused',
        leaving && 'leaving',
        problem && 'has-error',
        hasSync && 'has-sync',
      )}
      style={{ transform: `translateY(${top}px)` }}
      onClick={onClick}
      title={leaving ? 'Changed by a teammate and no longer matches your filters. Press R to refresh.' : undefined}
    >
      {remote && <span key={remote.at} className="flash" aria-hidden />}
      <div role="gridcell" className="c-check">
        <input
          type="checkbox"
          tabIndex={-1}
          checked={selected}
          aria-label={`Select ${deal.company}`}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            if ((e.nativeEvent as MouseEvent).shiftKey) store.selectRange(index);
            else store.toggleSelect(id, index);
          }}
        />
      </div>
      <div role="gridcell" className="c-deal">
        <span className="company">{deal.company}</span>
        <span className="sub">
          <span>{deal.id}</span>
          <span>{deal.licences} licences</span>
        </span>
      </div>
      <div role="gridcell" className="c-stage">
        <StageChip
          stage={deal.stage}
          pending={saving}
          showKey
          tabIndex={-1}
          label={`Stage: ${STAGE_LABEL[deal.stage]}. Change stage`}
          onClick={(e) => {
            e.stopPropagation();
            store.setFocus(index);
            if (!store.selected.has(id)) store.clearSelection();
            onOpenMoveMenu();
          }}
        />
      </div>
      <div role="gridcell" className="c-sync">
        <SyncCell id={id} pending={p} remoteSummary={remote?.summary} leaving={leaving} justSaved={justSaved} />
      </div>
      <div role="gridcell" className="num value c-value">
        {money(deal.value)}
      </div>
      <div role="gridcell" className={cx('c-owner', 'owner', isMe && 'owner-me')}>
        <Avatar name={deal.owner} highlight={isMe} />
        <span>{isMe ? 'You' : deal.owner}</span>
      </div>
      <div role="gridcell" className="num muted c-idle">
        {idleDays(deal, now)}d
      </div>
      <div role="gridcell" className={cx('c-close', deal.closeDate < now ? 'overdue' : 'muted')}>
        {relDays(deal.closeDate, now)}
      </div>
      <div role="gridcell" className="c-att">
        {att.reason && <span className={`att att-${att.reason}`}>{REASON_LABEL[att.reason]}</span>}
      </div>
    </div>
  );
});

/** A row whose details are still on the way: same size and position, so nothing jumps when it fills in. */
function SkeletonRow({
  id,
  index,
  top,
  focused,
  selected,
}: {
  id: string;
  index: number;
  top: number;
  focused: boolean;
  selected: boolean;
}) {
  return (
    <div
      id={id ? `row-${id}` : undefined}
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      aria-busy="true"
      className={cx('row', 'skeleton', selected && 'selected', focused && 'focused')}
      style={{ transform: `translateY(${top}px)` }}
    >
      <div role="gridcell" className="c-check" />
      <div role="gridcell" className="c-deal">
        <span className="bone w-60" />
        <span className="bone w-40 thin" />
      </div>
      <div role="gridcell" className="c-stage">
        <span className="bone w-50 pill" />
      </div>
      <div role="gridcell" className="c-sync">
        <span className="sr-only">Loading row {index + 1}</span>
      </div>
      <div role="gridcell" className="c-value">
        <span className="bone w-70" />
      </div>
      <div role="gridcell" className="c-owner">
        <span className="bone w-60" />
      </div>
      <div role="gridcell" className="c-idle" />
      <div role="gridcell" className="c-close" />
      <div role="gridcell" className="c-att" />
    </div>
  );
}
