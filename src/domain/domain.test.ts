import { describe, expect, it } from 'vitest';
import { attentionOf, idleDays, STALE_DAYS } from './attention';
import {
  buildView,
  countByStage,
  DEFAULT_FILTERS,
  matchesFilters,
  normalizeSearch,
  PRESET_IDS,
  PRESETS,
  sortKey,
  type Filters,
} from './filters';
import { CURRENT_USER, generateDeals, mulberry32, OWNERS } from './generate';
import { stageFromKey, stageKey, stepStage } from './stages';
import { isOpen, STAGES, type Deal } from './types';

const NOW = Date.UTC(2026, 9, 30, 12);
const DAY = 86_400_000;

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: 'D-00001',
    company: 'Acme Corp',
    companyLc: 'acme corp',
    licences: 50,
    value: 500_000,
    owner: CURRENT_USER,
    stage: 'new',
    lastActivityAt: NOW,
    closeDate: NOW + 30 * DAY,
    version: 1,
    updatedBy: 'system',
    updatedAt: NOW,
    ...over,
  };
}

const ALL: Filters = { ...DEFAULT_FILTERS, preset: null, owner: 'all', stage: 'all', attentionOnly: false };

describe('stages', () => {
  it('steps forward through the pipeline and stops at Won', () => {
    expect(stepStage('new', 1)).toBe('contacted');
    expect(stepStage('negotiation', 1)).toBe('won');
    expect(stepStage('won', 1)).toBeNull();
    expect(stepStage('lost', 1)).toBeNull();
  });

  it('steps back, treating Won and Lost as one terminal step after Negotiation', () => {
    expect(stepStage('contacted', -1)).toBe('new');
    expect(stepStage('won', -1)).toBe('negotiation');
    expect(stepStage('lost', -1)).toBe('negotiation');
    expect(stepStage('new', -1)).toBeNull();
  });

  it('maps number keys 1–7 to stages and back', () => {
    STAGES.forEach((s) => expect(stageFromKey(String(stageKey(s)))).toBe(s));
    expect(stageFromKey('0')).toBeNull();
    expect(stageFromKey('8')).toBeNull();
    expect(stageFromKey('x')).toBeNull();
    expect(stageFromKey('1.5')).toBeNull();
  });

  it('knows which stages are open', () => {
    expect(STAGES.filter(isOpen)).toEqual(['new', 'contacted', 'demo', 'proposal', 'negotiation']);
  });
});

describe('attention', () => {
  it('ranks overdue above closing-this-week above idle', () => {
    const overdue = attentionOf(deal({ closeDate: NOW - DAY }), NOW);
    const closing = attentionOf(deal({ closeDate: NOW + 3 * DAY }), NOW);
    const stale = attentionOf(deal({ lastActivityAt: NOW - (STALE_DAYS + 1) * DAY }), NOW);
    expect([overdue.reason, closing.reason, stale.reason]).toEqual(['overdue', 'closing', 'stale']);
    expect(overdue.score).toBeGreaterThan(closing.score);
    expect(closing.score).toBeGreaterThan(stale.score);
  });

  it('puts bigger deals first within the same reason', () => {
    const small = attentionOf(deal({ closeDate: NOW - DAY, value: 100_000 }), NOW);
    const big = attentionOf(deal({ closeDate: NOW - DAY, value: 9_000_000 }), NOW);
    expect(big.score).toBeGreaterThan(small.score);
  });

  it('never flags healthy or closed deals', () => {
    expect(attentionOf(deal(), NOW)).toEqual({ reason: null, score: 0 });
    expect(attentionOf(deal({ stage: 'won', closeDate: NOW - DAY }), NOW).reason).toBeNull();
    expect(attentionOf(deal({ stage: 'lost', closeDate: NOW - DAY }), NOW).reason).toBeNull();
  });

  it('counts idle days', () => {
    expect(idleDays(deal({ lastActivityAt: NOW - 10 * DAY - 1000 }), NOW)).toBe(10);
  });
});

describe('filters', () => {
  it('filters by owner: me, everyone, or a named person', () => {
    const mine = deal();
    const rahul = deal({ owner: 'Rahul Verma' });
    expect(matchesFilters(mine, { ...ALL, owner: 'me' }, CURRENT_USER, NOW)).toBe(true);
    expect(matchesFilters(rahul, { ...ALL, owner: 'me' }, CURRENT_USER, NOW)).toBe(false);
    expect(matchesFilters(rahul, { ...ALL, owner: 'Rahul Verma' }, CURRENT_USER, NOW)).toBe(true);
    expect(matchesFilters(mine, { ...ALL, owner: 'Rahul Verma' }, CURRENT_USER, NOW)).toBe(false);
  });

  it('filters by stage, including "open"', () => {
    expect(matchesFilters(deal({ stage: 'demo' }), { ...ALL, stage: 'open' }, CURRENT_USER, NOW)).toBe(true);
    expect(matchesFilters(deal({ stage: 'won' }), { ...ALL, stage: 'open' }, CURRENT_USER, NOW)).toBe(false);
    expect(matchesFilters(deal({ stage: 'won' }), { ...ALL, stage: 'won' }, CURRENT_USER, NOW)).toBe(true);
    expect(matchesFilters(deal({ stage: 'lost' }), { ...ALL, stage: 'won' }, CURRENT_USER, NOW)).toBe(false);
  });

  it('filters by minimum idle days', () => {
    const f = { ...ALL, idle: 90 };
    expect(matchesFilters(deal({ lastActivityAt: NOW - 91 * DAY }), f, CURRENT_USER, NOW)).toBe(true);
    expect(matchesFilters(deal({ lastActivityAt: NOW - 89 * DAY }), f, CURRENT_USER, NOW)).toBe(false);
  });

  it('filters to deals that need attention', () => {
    const f = { ...ALL, attentionOnly: true };
    expect(matchesFilters(deal({ closeDate: NOW - DAY }), f, CURRENT_USER, NOW)).toBe(true);
    expect(matchesFilters(deal(), f, CURRENT_USER, NOW)).toBe(false);
  });

  it('searches company, deal ID and owner name, case-insensitively', () => {
    const d = deal({ owner: 'Rahul Verma' });
    for (const q of ['acme', 'd-00001', 'rahul']) {
      expect(matchesFilters(d, { ...ALL, search: normalizeSearch(q) }, CURRENT_USER, NOW)).toBe(true);
    }
    expect(matchesFilters(d, { ...ALL, search: 'globex' }, CURRENT_USER, NOW)).toBe(false);
    expect(normalizeSearch('  AcMe ')).toBe('acme');
  });

  it('builds sort keys where bigger means earlier', () => {
    const d = deal({ value: 7, lastActivityAt: NOW - 5 * DAY, closeDate: NOW + 2 * DAY });
    expect(sortKey(d, 'value', NOW)).toBe(7);
    expect(sortKey(d, 'idle', NOW)).toBe(5 * DAY);
    expect(sortKey(d, 'closeDate', NOW)).toBe(-(NOW + 2 * DAY));
    expect(sortKey(d, 'company', NOW)).toBe('acme corp');
    expect(sortKey(d, 'priority', NOW)).toBe(attentionOf(d, NOW).score);
  });

  it('sorts a view, breaking ties by value', () => {
    const a = deal({ id: 'a', companyLc: 'beta', value: 1 });
    const b = deal({ id: 'b', companyLc: 'alpha', value: 2 });
    const c = deal({ id: 'c', companyLc: 'alpha', value: 3 });
    expect(buildView([a, b, c], { ...ALL, sort: 'value' }, CURRENT_USER, NOW)).toEqual(['c', 'b', 'a']);
    expect(buildView([a, b, c], { ...ALL, sort: 'company' }, CURRENT_USER, NOW)).toEqual(['c', 'b', 'a']);
    expect(buildView([a, b, c], { ...ALL, sort: 'company', search: 'beta' }, CURRENT_USER, NOW)).toEqual(['a']);
  });

  it('counts deals and value per stage, ignoring the stage filter', () => {
    const deals = [
      deal({ id: '1', stage: 'new', value: 10 }),
      deal({ id: '2', stage: 'won', value: 20 }),
      deal({ id: '3', stage: 'won', value: 30, owner: 'Rahul Verma' }),
    ];
    const c = countByStage(deals, { ...ALL, stage: 'new', owner: 'me' }, CURRENT_USER, NOW);
    expect(c.all).toEqual({ count: 2, value: 30 });
    expect(c.open).toEqual({ count: 1, value: 10 });
    expect(c.won).toEqual({ count: 1, value: 20 });
    expect(c.lost).toEqual({ count: 0, value: 0 });
  });

  it('has four presets, and Today means my open deals that need attention', () => {
    expect(PRESET_IDS).toEqual(['focus', 'mine', 'team', 'cleanup']);
    expect(PRESETS.focus.filters).toMatchObject({ owner: 'me', stage: 'open', attentionOnly: true });
    expect(PRESETS.cleanup.filters).toMatchObject({ idle: 90, stage: 'open', owner: 'all' });
    expect(DEFAULT_FILTERS.preset).toBe('focus');
  });
});

describe('generateDeals', () => {
  const deals = generateDeals(50_000, 42, NOW);

  it('generates 50,000 deals with unique, stable IDs', () => {
    expect(deals).toHaveLength(50_000);
    expect(new Set(deals.map((d) => d.id)).size).toBe(50_000);
    expect(deals[0].id).toBe('D-00001');
  });

  it('is deterministic for a seed, so every reviewer sees the same data', () => {
    expect(generateDeals(100, 42, NOW)).toEqual(deals.slice(0, 100));
    expect(generateDeals(100, 7, NOW)).not.toEqual(deals.slice(0, 100));
  });

  it('uses all 20 salespeople and every stage, with some stages over 9,000 deals', () => {
    expect(new Set(deals.map((d) => d.owner))).toEqual(new Set(OWNERS));
    expect(OWNERS).toHaveLength(20);
    const perStage = STAGES.map((s) => deals.filter((d) => d.stage === s).length);
    perStage.forEach((n) => expect(n).toBeGreaterThan(3000));
    expect(Math.max(...perStage)).toBeGreaterThan(9000);
  });

  it('produces consistent fields', () => {
    for (const d of deals.slice(0, 1000)) {
      expect(d.value).toBeGreaterThan(0);
      expect(d.licences).toBeGreaterThanOrEqual(5);
      expect(d.companyLc).toBe(d.company.toLowerCase());
      expect(d.lastActivityAt).toBeLessThanOrEqual(NOW);
      expect(d.version).toBe(1);
    }
  });

  it('has a seeded PRNG in [0, 1)', () => {
    const r = mulberry32(1);
    const xs = Array.from({ length: 1000 }, r);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
  });
});
