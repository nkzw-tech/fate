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
  ConnectionMetadata,
  ConnectionRef,
  Entity,
  EntityId,
  FateThenable,
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
  Snapshot,
  TypeConfig,
  View,
  ViewData,
  ViewEntity,
  ViewEntityName,
  ViewRef,
  ViewSelection,
  ViewSnapshot,
  ViewTag,
} from './types.ts';
export type { RequestMode, RequestOptions } from './client.ts';
export type { FateMutations } from './mutation.ts';
export type { Transport } from './transport.ts';

export { createClient, FateClient } from './client.ts';
export { ConnectionTag, isViewTag } from './types.ts';
export { createTRPCTransport } from './transport.ts';
export { getSelectionPlan } from './selection.ts';
export { mutation } from './mutation.ts';
export { toEntityId } from './ref.ts';
export { view } from './view.ts';
