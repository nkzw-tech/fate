import type { FateClient as FateClientT, FateMutations } from '@nkzw/fate';
import { createContext, ReactNode, use } from 'react';
import { Roots } from './useRequest.tsx';

type GeneratedFateClient = ReturnType<typeof import('react-fate/client').createFateClient>;
type Mutations = [GeneratedFateClient] extends [never]
  ? FateMutations
  : GeneratedFateClient extends FateClientT<any, infer M>
    ? M
    : FateMutations;

const FateContext = createContext<FateClientT<Roots, any> | null>(null);

/**
 * Provider component that supplies a configured `FateClient` to React hooks.
 */
export function FateClient({
  children,
  client,
}: {
  children: ReactNode;
  client: FateClientT<any, any>;
}) {
  return <FateContext value={client}>{children}</FateContext>;
}

/**
 * Returns the nearest `FateClient` from context.
 */
export function useFateClient<T extends [Roots, Mutations] = [Roots, Mutations]>(): FateClientT<
  T[0],
  T[1]
> {
  const context = use(FateContext);
  if (!context) {
    throw new Error(`react-fate: '<FateClient client={fate}>' is missing.`);
  }
  return context;
}
