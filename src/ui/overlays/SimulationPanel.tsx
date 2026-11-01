import { useState } from 'react';
import { DEFAULT_CONFIG, type ServerConfig } from '../../api/fakeServer';
import { count } from '../../lib/format';
import { useBootMs, useServer, useStore } from '../../store/context';
import { useTicker } from '../../store/hooks';
import { Button, CheckboxField, Panel, RangeField } from '../components';

// every preset sets every switch, so nothing is left over from the previous one
const PRESETS: [label: string, config: ServerConfig][] = [
  ['Brief defaults', DEFAULT_CONFIG],
  ['Chaos', { ...DEFAULT_CONFIG, failureRate: 0.5, minLatency: 1000, maxLatency: 3000, teammateRate: 20 }],
  ['Calm', { ...DEFAULT_CONFIG, failureRate: 0, minLatency: 50, maxLatency: 150, teammateRate: 0 }],
];

/** Controls for the fake backend, so reviewers can make things go wrong on purpose. */
export function SimulationPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const store = useStore();
  const api = useServer();
  const bootMs = useBootMs();
  useTicker(500); // live request counters
  const [, rerender] = useState(0);
  const c = api.config;
  const set = (patch: Partial<ServerConfig>) => {
    api.setConfig(patch);
    rerender((n) => n + 1);
  };

  if (!open) {
    return (
      <Button className="dev-toggle" onClick={onToggle} title="Simulation controls (`)">
        ⚙ Simulation {c.offline ? '· offline' : `· ${Math.round(c.failureRate * 100)}% fail`}
      </Button>
    );
  }

  const focusId = store.focusId;
  const s = api.stats;

  return (
    <Panel
      title="Simulation"
      label="Simulation controls"
      closeLabel="Close simulation controls"
      role="region"
      className="dev"
      onClose={onToggle}
    >
      <div className="field range">
        <span>
          Save delay: {c.minLatency}–{c.maxLatency} ms
        </span>
        <span className="pair">
          <RangeField
            ariaLabel="Minimum latency"
            min={0}
            max={5000}
            step={100}
            value={c.minLatency}
            onChange={(v) => set({ minLatency: v })}
          />
          <RangeField
            ariaLabel="Maximum latency"
            min={0}
            max={8000}
            step={100}
            value={c.maxLatency}
            onChange={(v) => set({ maxLatency: v })}
          />
        </span>
      </div>
      <RangeField
        label={`List and page loads: ${c.readLatency} ms`}
        min={0}
        max={2000}
        step={50}
        value={c.readLatency}
        onChange={(v) => set({ readLatency: v })}
      />
      <RangeField
        label={`Failed requests: ${Math.round(c.failureRate * 100)}%`}
        min={0}
        max={100}
        step={5}
        value={Math.round(c.failureRate * 100)}
        onChange={(v) => set({ failureRate: v / 100 })}
      />
      <RangeField
        label={`Teammate edits: ${c.teammateRate}/sec`}
        min={0}
        max={50}
        value={c.teammateRate}
        onChange={(v) => set({ teammateRate: v })}
      />
      <CheckboxField label="Offline (every save fails)" checked={c.offline} onChange={(v) => set({ offline: v })} />
      <CheckboxField
        label="Next save hits a conflict"
        checked={c.forceConflictNext}
        onChange={(v) => set({ forceConflictNext: v })}
      />

      <div className="dev-buttons">
        <Button disabled={!focusId} onClick={() => focusId && api.teammateEditNow(focusId, 'stage')}>
          Teammate moves focused deal
        </Button>
        <Button disabled={!focusId} onClick={() => focusId && api.teammateEditNow(focusId, 'value')}>
          Teammate edits its value
        </Button>
      </div>
      <div className="dev-buttons">
        {PRESETS.map(([label, config]) => (
          <Button key={label} onClick={() => set({ ...config })}>
            {label}
          </Button>
        ))}
      </div>

      <dl className="stats">
        <dt>Deals</dt>
        <dd>
          {count(store.size)} in this list {bootMs !== undefined && `(50,000 generated in ${bootMs} ms)`}
        </dd>
        <dt>Requests</dt>
        <dd>
          {count(s.requests)} sent, {s.inFlight} in flight, {count(s.failed)} failed, {count(s.conflicts)} conflicts
        </dd>
        <dt>Teammate edits</dt>
        <dd>{count(s.teammateEdits)}</dd>
      </dl>
    </Panel>
  );
}
