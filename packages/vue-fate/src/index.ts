/**
 * The vue fate library.
 *
 * @example
 * import { useView, view } from 'vue-fate';
 *
 * @module vue-fate
 */

export {
  clientRoot,
  createClient,
  createGraphQLTransport,
  createHTTPTransport,
  createTRPCTransport,
  defer,
  graphqlMutation,
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
  type InferFateAPI,
  type Pagination,
  type ViewRef,
  view,
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
export { useView, type ViewResource } from './useView.ts';
