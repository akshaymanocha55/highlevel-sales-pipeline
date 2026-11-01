import type { ReactNode } from 'react';

/** A keyboard key hint. Hidden on phones by CSS, where there is no keyboard. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}
