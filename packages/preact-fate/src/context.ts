import type { FateClient as FateClientT, FateMutations } from '@nkzw/fate';
import { createContext, h, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { Roots } from './useRequest.ts';

type GeneratedFateClient = ReturnType<typeof import('preact-fate/client').createFateClient>;
type Mutations = [GeneratedFateClient] extends [never]
  ? FateMutations
  : GeneratedFateClient extends FateClientT<any, infer M>
    ? M
    : FateMutations;

const FateContext = createContext<FateClientT<Roots, any> | null>(null);

/**
 * Provider component that supplies a configured `FateClient` to Preact hooks.
 */
export function FateClient({
  children,
  client,
}: {
  children?: ComponentChildren;
  client: FateClientT<any, any>;
}) {
  return h(FateContext.Provider, { value: client }, children);
}

/**
 * Returns the nearest `FateClient` from context.
 */
export function useFateClient<T extends [Roots, Mutations] = [Roots, Mutations]>(): FateClientT<
  T[0],
  T[1]
> {
  const context = useContext(FateContext);
  if (!context) {
    throw new Error(`preact-fate: '<FateClient client={fate}>' is missing.`);
  }
  return context;
}
