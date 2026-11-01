import type { ReactNode } from 'react';
import { stageKey } from '../../domain/stages';
import { STAGE_LABEL, type Stage } from '../../domain/types';
import { cx } from '../../lib/dom';

export interface StageChipProps {
  stage: Stage;
  /** dashed outline: shown on screen but not saved yet */
  pending?: boolean;
  /** show the stage's number key (1–7) */
  showKey?: boolean;
  /** makes the chip a button */
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** accessible name when it's a button */
  label?: string;
  /** extra content after the stage name, e.g. a keyboard hint */
  children?: ReactNode;
  tabIndex?: number;
}

/** A stage's colour dot and name. A span by default, a button when it does something. */
export function StageChip({ stage, pending, showKey, onClick, label, children, tabIndex }: StageChipProps) {
  const className = cx('chip', `stage-${stage}`, pending && 'pending');
  const content = (
    <>
      <span className="dot" aria-hidden />
      {STAGE_LABEL[stage]}
      {showKey && (
        <span className="step" aria-hidden>
          {stageKey(stage)}
        </span>
      )}
      {children}
    </>
  );
  if (!onClick) return <span className={className}>{content}</span>;
  return (
    <button type="button" className={className} onClick={onClick} aria-label={label} tabIndex={tabIndex}>
      {content}
    </button>
  );
}
