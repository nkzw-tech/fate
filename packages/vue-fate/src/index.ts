/**
 * The vue fate library.
 *
 * @example
 * import { useView, view } from 'vue-fate';
 *
 * @module vue-fate
 */

export {
  alias,
  type AliasedSelection,
  clientRoot,
  clientValueRoot,
  createClient,
  createGraphQLTransport,
  createHTTPTransport,
  createTRPCTransport,
  defer,
  graphqlMutation,
  graphqlValueMutation,
  graphqlValueRoot,
  mutation,
  valueMutation,
  toEntityId,
  type ConnectionRef,
  type InsertionTarget,
  type InsertPosition,
  type ListInsertion,
  type MutationInsertion,
  type Deferred,
  type GraphQLMutationDefinition,
  type GraphQLMutationInput,
  type GraphQLMutationMap,
  type GraphQLMutationOutput,
  type GraphQLSelectedResult,
  type GraphQLRootInput,
  type GraphQLRootOutput,
  type GraphQLValueRootDefinition,
  type GraphQLTransportOptions,
  type FateDehydratedState,
  type HydrationLimits,
  type HydrateOptions,
  type InferFateAPI,
  type Pagination,
  type Persistence,
  type PersistenceSession,
  type PersistenceSnapshot,
  type ViewRef,
  view,
  when,
  type ConditionalSelection,
  type AliasedView,
  type ParameterizedView,
} from '@nkzw/fate';

export {
  createFatePlugin,
  FateClient,
  FateClientKey,
  provideFateClient,
  useFateClient,
} from './context.ts';
export { useListView, type ListViewState } from './useListView.ts';
export { useLiveListView } from './useLiveListView.ts';
export { useLiveView } from './useLiveView.ts';
export { useRequest, type RequestResource } from './useRequest.ts';
export { useRequestState, type RequestStateResource } from './useRequestState.ts';
export { useView, type ViewResource } from './useView.ts';
export { useViews } from './useViews.ts';
