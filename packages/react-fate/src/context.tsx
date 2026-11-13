import type { ClientDefinitionOf, RegisteredClient } from '@nkzw/fate';
import type { FateClient as FateClientT, FateDehydratedState, FateMutations } from '@nkzw/fate';
import { createContext, ReactNode, use, useMemo } from 'react';
import { Roots } from './useRequest.tsx';

type GeneratedFateClient = RegisteredClient<
  ReturnType<typeof import('react-fate/client').createFateClient>
>;
type Mutations = [GeneratedFateClient] extends [never]
  ? FateMutations
  : ClientDefinitionOf<GeneratedFateClient> extends { mutations: infer M extends FateMutations }
    ? M
    : FateMutations;

type FateProviderValue = {
  client: FateClientT<Roots, any>;
  hydrationReader: FateClientT<Roots, any> | null;
  parent: FateProviderValue | null;
};

const FateContext = createContext<FateProviderValue | null>(null);

/**
 * Provider component that supplies a configured `FateClient` to React hooks.
 */
export function FateClient({
  children,
  client,
  hydrationState,
}: {
  children: ReactNode;
  client: FateClientT<any, any>;
  /** The original server snapshot to read while React hydrates this tree. */
  hydrationState?: FateDehydratedState;
}) {
  const parent = use(FateContext);
  const hydrationReader = useMemo(
    () => (hydrationState ? client.createHydrationReader(hydrationState) : null),
    [client, hydrationState],
  );
  const value = useMemo(
    () => ({ client, hydrationReader, parent }),
    [client, hydrationReader, parent],
  );
  return <FateContext value={value}>{children}</FateContext>;
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
  const selected = client ?? use(FateContext)?.client;
  if (!selected) {
    throw new Error(`react-fate: '<FateClient client={fate}>' is missing.`);
  }
  return selected;
}

export function useHydrationReader(client: FateClientT<any, any>) {
  let context = use(FateContext);
  while (context) {
    if (context.client === client && context.hydrationReader) {
      return context.hydrationReader;
    }
    context = context.parent;
  }
  return null;
}
