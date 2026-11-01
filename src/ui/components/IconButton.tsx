import type { ComponentProps } from 'react';
import { cx } from '../../lib/dom';

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'aria-label' | 'children'> {
  /** required: an icon has no visible text, so this is its accessible name */
  label: string;
  icon?: string;
}

/** A button that shows only an icon. Defaults to a close "×". */
export function IconButton({ label, icon = '×', className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} className={cx('icon-btn', className)} aria-label={label} title={label} {...rest}>
      <span aria-hidden>{icon}</span>
    </button>
  );
}
