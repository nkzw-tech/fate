export { alias, type AliasedSelection, type AliasedView } from './alias.ts';
/**
 * The fate core library.
 *
 * @example
 * import { view } from '@nkzw/fate';
 *
 * @module @nkzw/fate
 */

export type {
  AnyRecord as FateRecord,
  CheckedRequest,
  ConnectionMetadata,
  ConnectionRef,
  Deferred,
  DeferredMetadata,
  DeferredSelection,
  Entity,
  EntityId,
  FateThenable,
  FateRoots,
  ListItem,
  Mask,
  MutationDefinition,
  MutationEntity,
  MutationIdentifier,
  MutationInput,
  MutationResult,
  NodesItem,
  Pagination,
  Request,
  RequestResult,
  Selection,
  TypeConfig,
  View,
  ViewData,
  ViewEntity,
  ViewEntityName,
  ViewRef,
  ViewSelection,
  ViewSnapshot,
  ViewTag,
  ValueItem,
} from './types.ts';
export type { DeferredSnapshot, RequestMode, RequestOptions } from './client.ts';
export type { FateDehydratedState, HydrationLimits, HydrateOptions } from './hydration.ts';
export type {
  FateMutations,
  InsertionTarget,
  InsertPosition,
  ListInsertion,
  MutationInsertion,
} from './mutation.ts';
export type { ReadContext, Transport } from './transport.ts';
export type {
  GraphQLMutationDefinition,
  GraphQLMutationInput,
  GraphQLMutationMap,
  GraphQLMutationOutput,
  GraphQLRootInput,
  GraphQLRootOutput,
  GraphQLValueRootDefinition,
  GraphQLTransportOptions,
} from './graphqlTransport.ts';

export { createClient, FateClient } from './client.ts';
export { ConnectionTag, DeferTag, DeferredTag, isViewTag } from './types.ts';
export { defer, getDeferredMetadata, isDeferred } from './defer.ts';
export { createTRPCTransport } from './transport.ts';
export {
  createGraphQLTransport,
  graphqlMutation,
  graphqlValueMutation,
  graphqlValueRoot,
} from './graphqlTransport.ts';
export { createHTTPTransport } from './httpTransport.ts';
export { liveConnectionTopic, liveEntityTopic, liveGlobalConnectionTopic } from './liveTopics.ts';
export { getListEntries } from './list.ts';
export type { ListEntry } from './list.ts';
export type { List } from './store.ts';
export type { InferFateAPI } from './server/http.ts';
export type {
  FateLiveConnectionEvent,
  FateLiveEvent,
  FateOperation,
  FateProtocolRequest,
  FateProtocolResponse,
} from './protocol.ts';
export { getSelectionPlan } from './selection.ts';
export { isRecord } from './record.ts';
export { mutation, valueMutation } from './mutation.ts';
export { clientRoot, clientValueRoot } from './root.ts';
export { toEntityId } from './ref.ts';
export { view, resolveView, type ParameterizedView } from './view.ts';

export type {
  PersistedMutationStatus,
  Persistence,
  PersistenceSession,
  PersistenceSnapshot,
  MutationIdentity,
  RequestPersistenceOptions,
} from './persistence-types.ts';

export type { GraphQLArgumentSchema } from './graphqlSchema.ts';

export { GraphQLRequestError, type GraphQLErrorPayload } from './graphql-error.ts';

export type { RequestObserver, RequestState, RequestStateOptions } from './request-observer.ts';

export { when, type ConditionalSelection } from './when.ts';

export type { GraphQLSelectedResult } from './graphql-types.ts';

export type { RefetchConfig, RefetchArgument, RefetchArguments } from './refetch.ts';
