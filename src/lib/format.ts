const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export const money = (v: number) => inr.format(v);
export { count } from './text';

/** ₹4.2 Cr / ₹38.5 L: how Indian sales teams read big numbers */
export function moneyShort(v: number) {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(v >= 1e9 ? 0 : 1)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  return inr.format(v);
}

const DAY = 86_400_000;

export function relDays(ts: number, now = Date.now()) {
  const d = Math.round((ts - now) / DAY);
  if (d === 0) return 'today';
  return d > 0 ? `in ${d}d` : `${-d}d ago`;
}

export const firstName = (full: string) => full.split(' ')[0];
