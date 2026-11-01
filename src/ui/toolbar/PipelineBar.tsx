import type { StageFilter } from '../../domain/filters';
import { STAGE_LABEL, STAGES } from '../../domain/types';
import { cx } from '../../lib/dom';
import { count, moneyShort } from '../../lib/format';
import { useStore } from '../../store/context';
import { useTopic } from '../../store/hooks';
import { Button } from '../components';

/**
 * The pipeline at a glance: deal count and value per stage. Each stage is also a filter.
 * Every box has the same width; the coloured fill shows the stage's size relative to the
 * biggest one, so changing filters animates the fills but never moves the layout.
 */
export function PipelineBar() {
  const store = useStore();
  useTopic('meta');
  const c = store.counts;
  const active = store.filters.stage;
  const max = Math.max(1, ...STAGES.map((s) => c[s].count));

  const scope = (s: StageFilter, label: string) => (
    <Button
      className={cx('scope', active === s && 'active')}
      aria-pressed={active === s}
      onClick={() => store.setFilters({ stage: s })}
    >
      <span className="scope-label">{label}</span>
      <span className="scope-num">{count(c[s].count)}</span>
      <span className="scope-val">{moneyShort(c[s].value)}</span>
    </Button>
  );

  return (
    <section className="pipeline" aria-label="Pipeline by stage. Choose a stage to filter.">
      <div className="scopes">
        {scope('open', 'Open deals')}
        {scope('all', 'All deals')}
      </div>
      <div className="funnel" role="toolbar" aria-label="Stages">
        {STAGES.map((s) => (
          <Button
            key={s}
            className={cx('seg', `stage-${s}`, active === s && 'active', c[s].count === 0 && 'is-empty')}
            aria-pressed={active === s}
            aria-label={`${STAGE_LABEL[s]}: ${count(c[s].count)} deals, ${moneyShort(c[s].value)}`}
            onClick={() => store.setFilters({ stage: s })}
          >
            <span className="seg-inner">
              <span className="seg-bar">
                <span className="seg-fill" style={{ width: `${(c[s].count / max) * 100}%` }} />
              </span>
              <span className="seg-name">{STAGE_LABEL[s]}</span>
              <span className="seg-line">
                <span className="seg-num">{count(c[s].count)}</span>
                <span className="seg-val">{moneyShort(c[s].value)}</span>
              </span>
            </span>
          </Button>
        ))}
      </div>
    </section>
  );
}
