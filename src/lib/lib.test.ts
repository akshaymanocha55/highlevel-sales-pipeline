import { describe, expect, it } from 'vitest';
import { cx } from './dom';
import { firstName, money, moneyShort, relDays } from './format';
import { count, plural } from './text';

describe('formatting', () => {
  it('formats rupees the Indian way', () => {
    expect(money(500000)).toBe('₹5,00,000');
    expect(count(1234567)).toBe('12,34,567');
  });

  it('shortens big amounts to lakh and crore', () => {
    expect(moneyShort(45_000)).toBe('₹45,000');
    expect(moneyShort(3_850_000)).toBe('₹38.5 L');
    expect(moneyShort(42_000_000)).toBe('₹4.2 Cr');
    expect(moneyShort(12_980_000_000)).toBe('₹1298 Cr');
  });

  it('describes dates relative to now', () => {
    const now = 1_000_000_000_000;
    const day = 86_400_000;
    expect(relDays(now, now)).toBe('today');
    expect(relDays(now + 3 * day, now)).toBe('in 3d');
    expect(relDays(now - 2 * day, now)).toBe('2d ago');
  });

  it('pluralises with Indian digit grouping', () => {
    expect(plural(1, 'deal')).toBe('1 deal');
    expect(plural(2500, 'deal')).toBe('2,500 deals');
    expect(plural(0, 'deal')).toBe('0 deals');
  });

  it('gets first names and joins class names', () => {
    expect(firstName('Rahul Verma')).toBe('Rahul');
    expect(cx('a', false, null, undefined, 'b')).toBe('a b');
  });
});
