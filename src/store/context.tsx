import { createContext, useContext, type ReactNode } from 'react';
import type { FakeServer } from '../api/fakeServer';
import type { PipelineStore } from './pipelineStore';

interface AppContext {
  store: PipelineStore;
  /** the simulated backend, for the simulation controls */
  server: FakeServer;
  /** how long generating the demo data took */
  bootMs?: number;
}

const Ctx = createContext<AppContext | null>(null);

export function StoreProvider({ store, server, bootMs, children }: AppContext & { children: ReactNode }) {
  return <Ctx.Provider value={{ store, server, bootMs }}>{children}</Ctx.Provider>;
}

function useAppContext() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}

export const useStore = () => useAppContext().store;
export const useServer = () => useAppContext().server;
export const useBootMs = () => useAppContext().bootMs;
