import { PRESET_IDS, PRESETS } from '../../domain/filters';
import { useStore } from '../../store/context';
import { useTopic } from '../../store/hooks';
import { Button } from '../components';

/** Saved views, one key each (Shift+1–4). */
export function Presets() {
  const store = useStore();
  useTopic('view');
  const active = store.filters.preset;
  return (
    <nav className="presets" aria-label="Saved views">
      {PRESET_IDS.map((id, i) => (
        <Button
          key={id}
          className={active === id ? 'active' : undefined}
          aria-pressed={active === id}
          title={`${PRESETS[id].hint} (Shift+${i + 1})`}
          shortcut={`⇧${i + 1}`}
          onClick={() => store.applyPreset(id)}
        >
          {PRESETS[id].label}
        </Button>
      ))}
    </nav>
  );
}
