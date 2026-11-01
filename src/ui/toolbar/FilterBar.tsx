import { useEffect, useState } from 'react';
import { normalizeSearch, type SortKey } from '../../domain/filters';
import { OWNERS } from '../../domain/generate';
import { focusGrid, SEARCH_ID } from '../../lib/dom';
import { useStore } from '../../store/context';
import { useTopic } from '../../store/hooks';
import { CheckboxField, SelectField } from '../components';

export const SEARCH_DEBOUNCE_MS = 150;

const IDLE_OPTIONS: [number, string][] = [
  [0, 'Any'],
  [14, '14+ days'],
  [30, '30+ days'],
  [60, '60+ days'],
  [90, '90+ days'],
];

const SORT_OPTIONS: [SortKey, string][] = [
  ['priority', 'Most urgent'],
  ['value', 'Highest value'],
  ['idle', 'Longest idle'],
  ['closeDate', 'Closing soonest'],
  ['company', 'Company A–Z'],
];

function SearchBox() {
  const store = useStore();
  const applied = store.filters.search;
  const [text, setText] = useState(applied);
  const [lastApplied, setLastApplied] = useState(applied);

  // a preset or "clear filters" changed the search from outside: show that in the box
  if (applied !== lastApplied) {
    setLastApplied(applied);
    if (applied !== normalizeSearch(text)) setText(applied);
  }

  // debounced: re-filtering 50k deals on every keystroke is wasted work
  useEffect(() => {
    if (normalizeSearch(text) === store.filters.search) return;
    const t = setTimeout(() => store.setFilters({ search: text }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, store]);

  return (
    <input
      id={SEARCH_ID}
      type="search"
      placeholder="Search company, ID or owner"
      aria-label="Search deals by company, ID or owner"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          focusGrid();
        }
      }}
    />
  );
}

export function FilterBar() {
  const store = useStore();
  useTopic('view'); // filters change together with the view, synchronously
  const f = store.filters;
  const ownerOptions: [string, string][] = [
    ['me', 'Me'],
    ['all', 'Everyone'],
    ...OWNERS.filter((o) => o !== store.me).map((o): [string, string] => [o, o]),
  ];

  return (
    <div className="filters">
      <SearchBox />
      <SelectField
        label="Owner"
        compact
        value={f.owner}
        options={ownerOptions}
        onChange={(owner) => store.setFilters({ owner })}
      />
      <SelectField
        label="Idle"
        compact
        value={f.idle}
        options={IDLE_OPTIONS}
        onChange={(idle) => store.setFilters({ idle })}
      />
      <SelectField
        label="Sort"
        compact
        value={f.sort}
        options={SORT_OPTIONS}
        onChange={(sort) => store.setFilters({ sort })}
      />
      <CheckboxField
        label="Needs attention only"
        checked={f.attentionOnly}
        onChange={(attentionOnly) => store.setFilters({ attentionOnly })}
      />
    </div>
  );
}
