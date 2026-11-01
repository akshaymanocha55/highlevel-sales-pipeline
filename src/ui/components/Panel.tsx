import type { ReactNode } from 'react';
import { cx } from '../../lib/dom';
import { IconButton } from './IconButton';
import { useAutoFocusRef } from './useFocusManagement';

export interface PanelProps {
  /** visible heading */
  title: ReactNode;
  /** accessible name, if it should differ from the visible title */
  label?: string;
  onClose: () => void;
  closeLabel?: string;
  /** "dialog" for a task the user must deal with, "region" for a tool that sits alongside */
  role?: 'dialog' | 'region';
  className?: string;
  children: ReactNode;
}

/**
 * A non-modal floating panel with a title and a close button. Takes focus when it opens,
 * closes on Escape, and returns focus when it closes. The page behind stays usable.
 */
export function Panel({
  title,
  label,
  onClose,
  closeLabel = 'Close',
  role = 'dialog',
  className,
  children,
}: PanelProps) {
  const ref = useAutoFocusRef<HTMLElement>();
  return (
    <section
      ref={ref}
      role={role}
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      tabIndex={-1}
      className={cx('panel', className)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <h2>{title}</h2>
        <IconButton label={closeLabel} onClick={onClose} />
      </header>
      {children}
    </section>
  );
}
