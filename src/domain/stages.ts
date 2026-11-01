import { STAGES, type Stage } from './types';

/**
 * One step along the pipeline.
 * Won and Lost are both terminal: forward from Negotiation is Won, and back from either is Negotiation.
 * Returns null when there is nowhere to go.
 */
export function stepStage(stage: Stage, dir: 1 | -1): Stage | null {
  if (dir === 1) {
    if (stage === 'won' || stage === 'lost') return null;
    return STAGES[STAGES.indexOf(stage) + 1];
  }
  if (stage === 'won' || stage === 'lost') return 'negotiation';
  if (stage === 'new') return null;
  return STAGES[STAGES.indexOf(stage) - 1];
}

/** 1-based keyboard shortcut for a stage (1 = New Lead … 7 = Lost). */
export const stageKey = (stage: Stage) => STAGES.indexOf(stage) + 1;

export const stageFromKey = (key: string): Stage | null => {
  const n = Number(key);
  return Number.isInteger(n) && n >= 1 && n <= STAGES.length ? STAGES[n - 1] : null;
};
