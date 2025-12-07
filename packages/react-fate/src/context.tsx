import type { FateClient as FateClientT, FateMutations } from '@nkzw/fate';
import { createContext, ReactNode, use } from 'react';
import type { ClientMutations } from './index.tsx';

type Mutations = keyof ClientMutations extends never ? FateMutations : ClientMutations;

const FateContext = createContext<FateClientT<any> | null>(null);

/**
 * Provider component that supplies a configured `FateClient` to React hooks.
 */
export function FateClient({
  children,
  client,
}: {
  children: ReactNode;
  client: FateClientT<any>;
}) {
  return <FateContext value={client}>{children}</FateContext>;
}

/**
 * Returns the nearest `FateClient` from context.
 */
export function useFateClient<M extends Mutations>(): FateClientT<M> {
  const context = use(FateContext);
  if (!context) {
    throw new Error(`react-fate: '<FateContext value={client}>' is missing.`);
  }
  return context;
}
