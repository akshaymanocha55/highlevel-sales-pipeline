import { attentionOf } from './attention';
import { isOpen, STAGES, type Deal, type Stage } from './types';

export type SortKey = 'priority' | 'value' | 'idle' | 'closeDate' | 'company';
export type StageFilter = 'open' | 'all' | Stage;
export type PresetId = 'focus' | 'mine' | 'team' | 'cleanup';

export interface Filters {
  /** the saved view these filters came from; null once the user tweaks anything */
  preset: PresetId | null;
  /** already normalised: trimmed + lowercase */
  search: string;
  /** 'me' | 'all' | an owner's full name */
  owner: string;
  stage: StageFilter;
  /** minimum days without activity, 0 = any */
  idle: number;
  attentionOnly: boolean;
  sort: SortKey;
}

type PresetFilters = Omit<Filters, 'preset' | 'search'>;

export const PRESETS: Record<PresetId, { label: string; hint: string; filters: PresetFilters }> = {
  focus: {
    label: 'Today',
    hint: 'My open deals that need action, most urgent first',
    filters: { owner: 'me', stage: 'open', idle: 0, attentionOnly: true, sort: 'priority' },
  },
  mine: {
    label: 'My pipeline',
    hint: 'All my open deals',
    filters: { owner: 'me', stage: 'open', idle: 0, attentionOnly: false, sort: 'priority' },
  },
  team: {
    label: 'Whole team',
    hint: 'Every deal in the pipeline',
    filters: { owner: 'all', stage: 'all', idle: 0, attentionOnly: false, sort: 'value' },
  },
  cleanup: {
    label: 'Quarter-end cleanup',
    hint: 'Open deals idle for 90+ days. Select all and move to Lost',
    filters: { owner: 'all', stage: 'open', idle: 90, attentionOnly: false, sort: 'idle' },
  },
};

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

export const DEFAULT_FILTERS: Filters = { preset: 'focus', search: '', ...PRESETS.focus.filters };

const DAY_MS = 86_400_000;

export const normalizeSearch = (q: string) => q.trim().toLowerCase();

// Only ~20 owners exist, so cache their lowercased names instead of lowercasing 50k times per keystroke.
const ownerLcCache = new Map<string, string>();
function ownerLc(owner: string) {
  let lc = ownerLcCache.get(owner);
  if (lc === undefined) {
    lc = owner.toLowerCase();
    ownerLcCache.set(owner, lc);
  }
  return lc;
}

/** Does this deal belong in a view with these filters? `me` is the signed-in user's name. */
export function matchesFilters(d: Deal, f: Filters, me: string, now: number): boolean {
  if (f.owner === 'me' ? d.owner !== me : f.owner !== 'all' && d.owner !== f.owner) return false;
  if (f.stage === 'open' ? !isOpen(d.stage) : f.stage !== 'all' && d.stage !== f.stage) return false;
  if (f.idle > 0 && now - d.lastActivityAt < f.idle * DAY_MS) return false;
  if (f.attentionOnly && attentionOf(d, now).reason === null) return false;
  if (f.search) {
    const q = f.search;
    if (!d.companyLc.includes(q) && !d.id.toLowerCase().includes(q) && !ownerLc(d.owner).includes(q)) return false;
  }
  return true;
}

/** Bigger key = earlier in the list (except `company`, which sorts A→Z). */
export function sortKey(d: Deal, sort: SortKey, now: number): number | string {
  switch (sort) {
    case 'priority':
      return attentionOf(d, now).score;
    case 'value':
      return d.value;
    case 'idle':
      return now - d.lastActivityAt;
    case 'closeDate':
      return -d.closeDate; // soonest first
    case 'company':
      return d.companyLc;
  }
}

/** Filter + sort a set of deals into an ordered list of ids. Ties are broken by value, highest first. */
export function buildView(deals: Iterable<Deal>, f: Filters, me: string, now: number): string[] {
  const rows: { id: string; k: number | string; v: number }[] = [];
  for (const d of deals) {
    if (matchesFilters(d, f, me, now)) rows.push({ id: d.id, k: sortKey(d, f.sort, now), v: d.value });
  }
  if (f.sort === 'company') {
    rows.sort((a, b) => (a.k as string).localeCompare(b.k as string) || b.v - a.v);
  } else {
    rows.sort((a, b) => (b.k as number) - (a.k as number) || b.v - a.v);
  }
  return rows.map((r) => r.id);
}

export type StageCounts = Record<'open' | 'all' | Stage, { count: number; value: number }>;

export function emptyCounts(): StageCounts {
  const c = {} as StageCounts;
  for (const k of ['open', 'all', ...STAGES] as const) c[k] = { count: 0, value: 0 };
  return c;
}

/** Count and value per stage for everything the filters allow, ignoring the stage filter itself. */
export function countByStage(deals: Iterable<Deal>, f: Filters, me: string, now: number): StageCounts {
  const c = emptyCounts();
  const anyStage: Filters = { ...f, stage: 'all' };
  for (const d of deals) {
    if (!matchesFilters(d, anyStage, me, now)) continue;
    c.all.count++;
    c.all.value += d.value;
    c[d.stage].count++;
    c[d.stage].value += d.value;
    if (isOpen(d.stage)) {
      c.open.count++;
      c.open.value += d.value;
    }
  }
  return c;
}
