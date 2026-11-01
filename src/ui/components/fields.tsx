import type { ReactNode } from 'react';
import { cx } from '../../lib/dom';

type Option<T> = readonly [value: T, label: string];

export interface SelectFieldProps<T extends string | number> {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  /** hide the visible label on small screens (it stays available to screen readers) */
  compact?: boolean;
}

/** A labelled dropdown that hands back the option's real value (number or string), not text. */
export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
  compact,
}: SelectFieldProps<T>) {
  return (
    <label className={cx('field', 'sel', compact && 'compact')}>
      <span className="lbl">{label}</span>
      <select
        value={String(value)}
        onChange={(e) => {
          const picked = options.find(([v]) => String(v) === e.target.value);
          if (picked) onChange(picked[0]);
        }}
      >
        {options.map(([v, text]) => (
          <option key={String(v)} value={String(v)}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

export interface CheckboxFieldProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function CheckboxField({ label, checked, onChange }: CheckboxFieldProps) {
  return (
    <label className="field check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export interface RangeFieldProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** visible label (wraps the slider) */
  label?: ReactNode;
  /** accessible name when there is no visible label */
  ariaLabel?: string;
}

export function RangeField({ value, min, max, step = 1, onChange, label, ariaLabel }: RangeFieldProps) {
  const input = (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
  if (label === undefined) return input;
  return (
    <label className="field range">
      {label}
      {input}
    </label>
  );
}
