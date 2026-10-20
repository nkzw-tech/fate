export { alias, type AliasedSelection } from '@nkzw/fate';
/**
 * The react fate library.
 *
 * @example
 * import { useView, view } from 'react-fate';
 *
 * @module react-fate
 */

export {
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
  GraphQLRequestError,
  mutation,
  valueMutation,
  toEntityId,
  type ConnectionRef,
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

export { FateClient, useFateClient } from './context.tsx';
export { useLiveView } from './useLiveView.tsx';
export { useLiveListView } from './useLiveListView.tsx';
export { useView } from './useView.tsx';
export { useViews } from './useViews.tsx';
export { useRequest } from './useRequest.tsx';
export { useRefetch } from './useRefetch.tsx';
export { useListView } from './useListView.tsx';

export { useRequestState } from './useRequestState.tsx';
