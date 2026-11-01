import { useStore } from '../../store/context';
import { Button } from '../components';

/** An empty list says why, and offers the way out. */
export function EmptyState() {
  const store = useStore();
  const f = store.filters;
  const closedStage = f.stage === 'won' || f.stage === 'lost';

  if (f.attentionOnly && closedStage) {
    return (
      <div className="grid-empty">
        <strong>Won and Lost deals never need attention</strong>
        <span>"Needs attention only" hides every closed deal.</span>
        <Button onClick={() => store.setFilters({ attentionOnly: false })}>
          Show all {f.stage === 'won' ? 'Won' : 'Lost'} deals
        </Button>
      </div>
    );
  }
  if (f.attentionOnly) {
    return (
      <div className="grid-empty">
        <strong>Nothing needs attention here</strong>
        <span>No overdue, closing-this-week or idle deals match these filters.</span>
        <Button onClick={() => store.setFilters({ attentionOnly: false })}>Show all deals in this view</Button>
      </div>
    );
  }
  return (
    <div className="grid-empty">
      <strong>No deals match these filters</strong>
      <Button
        onClick={() => store.setFilters({ search: '', owner: 'all', stage: 'all', idle: 0, attentionOnly: false })}
      >
        Clear all filters
      </Button>
    </div>
  );
}
