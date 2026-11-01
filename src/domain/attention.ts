import { isOpen, type Deal } from './types';

const DAY = 86_400_000;
export const STALE_DAYS = 14;

export type AttentionReason = 'overdue' | 'closing' | 'stale' | null;

export const REASON_LABEL: Record<Exclude<AttentionReason, null>, string> = {
  overdue: 'Close date passed',
  closing: 'Closes this week',
  stale: 'No activity 14d+',
};

/**
 * Answers "which deals should I work on today?".
 * Rule-based on purpose: a salesperson must be able to understand *why* a deal is on top.
 */
export function attentionOf(d: Deal, now: number): { reason: AttentionReason; score: number } {
  if (!isOpen(d.stage)) return { reason: null, score: 0 };
  // value weight: 1..~2, so big deals float up within the same urgency bucket
  const valueWeight = 1 + Math.min(d.value / 5_000_000, 1);
  if (d.closeDate < now) return { reason: 'overdue', score: 300 * valueWeight };
  if (d.closeDate - now <= 7 * DAY) return { reason: 'closing', score: 200 * valueWeight };
  if (now - d.lastActivityAt >= STALE_DAYS * DAY) return { reason: 'stale', score: 100 * valueWeight };
  return { reason: null, score: 0 };
}

export const idleDays = (d: Deal, now: number) => Math.floor((now - d.lastActivityAt) / DAY);
