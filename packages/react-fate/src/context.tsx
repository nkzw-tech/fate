import type { FateClient as FateClientT } from '@nkzw/fate';
import { createContext, ReactNode, use } from 'react';

const FateContext = createContext<FateClientT | null>(null);

export function FateClient({
  children,
  client,
}: {
  children: ReactNode;
  client: FateClientT;
}) {
  return <FateContext value={client}>{children}</FateContext>;
}

export function useFateClient(): FateClientT {
  const context = use(FateContext);
  if (!context) {
    throw new Error(`react-fate: '<FateContext value={client}>' is missing.`);
  }
  return context;
}
