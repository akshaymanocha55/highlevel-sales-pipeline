import type { ComponentProps } from 'react';
import { cx } from '../../lib/dom';
import { Kbd } from './Kbd';

export type ButtonVariant = 'default' | 'primary' | 'link';

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  /** keyboard shortcut shown after the label, e.g. "Z" */
  shortcut?: string;
}

/**
 * The one button. Defaults to type="button" so it never submits a form by accident.
 * Everything else (onClick, disabled, aria-*, ref) passes straight through.
 */
export function Button({ variant = 'default', shortcut, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cx(variant !== 'default' && variant, className)} {...rest}>
      {children}
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  );
}
