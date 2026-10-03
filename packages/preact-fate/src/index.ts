export { alias, type AliasedSelection } from '@nkzw/fate';
/**
 * The preact fate library.
 *
 * @example
 * import { useView, view } from 'preact-fate';
 *
 * @module preact-fate
 */

export {
  clientRoot,
  createClient,
  createGraphQLTransport,
  createHTTPTransport,
  createTRPCTransport,
  defer,
  graphqlMutation,
  GraphQLRequestError,
  mutation,
  toEntityId,
  type ConnectionRef,
  type Deferred,
  type GraphQLMutationDefinition,
  type GraphQLMutationInput,
  type GraphQLMutationMap,
  type GraphQLMutationOutput,
  type GraphQLTransportOptions,
  type FateDehydratedState,
  type HydrationLimits,
  type HydrateOptions,
  type Pagination,
  type Persistence,
  type PersistenceSession,
  type PersistenceSnapshot,
  type ViewRef,
  type InferFateAPI,
  view,
  when,
  type ConditionalSelection,
  type AliasedView,
  type ParameterizedView,
} from '@nkzw/fate';

export { FateClient, useFateClient } from './context.ts';
export { lazy, Suspense } from 'preact-suspense';
export { useLiveView } from './useLiveView.ts';
export { useLiveListView } from './useLiveListView.ts';
export { useView } from './useView.ts';
export { useRequest } from './useRequest.ts';
export { useListView } from './useListView.ts';

export { useRequestState } from './useRequestState.ts';
