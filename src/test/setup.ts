import { afterEach } from 'vitest';

// DOM-only setup, skipped for the plain-logic tests that run in Node
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');

  // jsdom has no layout engine: stub the few APIs the virtualised grid touches
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollTo ??= function scrollTo() {};
  // give elements a desktop-sized box so the virtualised grid renders a screenful of rows
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => 1200 },
    clientHeight: { configurable: true, get: () => 800 },
  });

  const { cleanup } = await import('@testing-library/react');
  afterEach(() => {
    cleanup();
  });
}
