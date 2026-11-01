import type { ReactNode } from 'react';
import { cx } from '../../lib/dom';
import { trapTab, useAutoFocusRef } from './useFocusManagement';

export interface DialogProps {
  /** accessible name */
  label: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
  /** extra key handling inside the dialog (runs before Escape handling) */
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

/**
 * Modal dialog: dims the page, takes focus (or gives it to a `data-autofocus` child),
 * keeps Tab inside, closes on Escape or a click outside, and returns focus on close.
 * Keys never leak to the page's global shortcuts.
 */
export function Dialog({ label, onClose, className, children, onKeyDown }: DialogProps) {
  const ref = useAutoFocusRef<HTMLDivElement>();
  return (
    <div className="overlay" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cx('dialog', className)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          } else {
            trapTab(e, ref.current);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
