import type { ClientDefinitionOf, RegisteredClient } from '@nkzw/fate';
import type { FateClient as FateClientT, FateMutations } from '@nkzw/fate';
import { createContext, ReactNode, use } from 'react';
import { Roots } from './useRequest.tsx';

type GeneratedFateClient = RegisteredClient<
  ReturnType<typeof import('react-fate/client').createFateClient>
>;
type Mutations = [GeneratedFateClient] extends [never]
  ? FateMutations
  : ClientDefinitionOf<GeneratedFateClient> extends { mutations: infer M extends FateMutations }
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
  return useViewClient();
}

export function useViewClient(client?: FateClientT<any, any> | null): FateClientT<any, any> {
  const selected = client ?? use(FateContext);
  if (!selected) {
    throw new Error(`react-fate: '<FateClient client={fate}>' is missing.`);
  }
  return selected;
}
