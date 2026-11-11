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
  type InsertionTarget,
  type InsertPosition,
  type ListInsertion,
  type ListRemoval,
  type MutationInsertion,
  type MutationRemoval,
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
  viewFor,
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
export { useRequest, type UseRequestOptions } from './useRequest.tsx';
export { useRefetch } from './useRefetch.tsx';
export { useListView } from './useListView.tsx';

export {
  clientQuery,
  clientSchema,
  dataView,
  list,
  computed,
  memo,
  field,
  type ClientSchema,
  type ClientStore,
  type ClientMutationBuilder,
  type ClientMutationContext,
  type EntityOf,
} from '@nkzw/fate';
