import type { TRPCClient } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';
import { AnyRecord, Pagination, type MutationShape } from './types.ts';

/**
 * Normalized representation of args passed to a transport.
 */
export type ResolvedArgsPayload = AnyRecord;

type TransportMutations = Record<string, MutationShape>;
type EmptyTransportMutations = Record<never, MutationShape>;

/**
 * Contract the fate client expects from a network transport. The transport is
 * responsible for fetching records by ID, fetching lists, and executing
 * mutations with the provided selections.
 */
export interface Transport<Mutations extends TransportMutations = EmptyTransportMutations> {
  fetchById(
    type: string,
    ids: Array<string | number>,
    select: Iterable<string>,
    args?: ResolvedArgsPayload,
  ): Promise<Array<unknown>>;
  fetchList?(
    proc: string,
    select: Iterable<string>,
    args?: ResolvedArgsPayload,
  ): Promise<{
    items: Array<{ cursor: string | undefined; node: unknown }>;
    pagination: Pagination;
  }>;
  fetchQuery?(proc: string, select: Iterable<string>, args?: ResolvedArgsPayload): Promise<unknown>;
  mutate?<K extends Extract<keyof Mutations, string>>(
    proc: K,
    input: Mutations[K]['input'],
    select: Set<string>,
  ): Promise<Mutations[K]['output']>;
}

/**
 * Mapping of entity type to tRPC procedures used for fetching entities by ID.
 */
export type TRPCByIdResolvers<AppRouter extends AnyRouter> = Record<
  string,
  (
    client: TRPCClient<AppRouter>,
  ) => (input: {
    args?: ResolvedArgsPayload;
    ids: Array<string | number>;
    select: Array<string>;
  }) => Promise<Array<unknown>>
>;

/**
 * Mapping of list procedure name to a tRPC resolver factory.
 */
export type TRPCListResolvers<AppRouter extends AnyRouter> = Record<
  string,
  (client: TRPCClient<AppRouter>) => (input: {
    args?: ResolvedArgsPayload;
    select: Array<string>;
  }) => Promise<{
    items: Array<{ cursor: string | undefined; node: unknown }>;
    pagination: Pagination;
  }>
>;

/**
 * Mapping of query procedure name to a tRPC resolver factory.
 */
export type TRPCQueryResolvers<AppRouter extends AnyRouter> = Record<
  string,
  (
    client: TRPCClient<AppRouter>,
  ) => (input: { args?: ResolvedArgsPayload; select: Array<string> }) => Promise<unknown>
>;

/**
 * Mapping of a mutation procedure name to a tRPC resolver factory.
 */
type MutationResolver<AppRouter extends AnyRouter> = (
  client: TRPCClient<AppRouter>,
) => (input: any) => Promise<any>;

export type TRPCMutationResolvers<AppRouter extends AnyRouter> = Record<
  string,
  MutationResolver<AppRouter>
>;

type MutationMapFromResolvers<R extends Record<string, MutationResolver<any>>> = {
  [K in keyof R]: R[K] extends (client: any) => (input: infer Input) => Promise<infer Output>
    ? { input: Input; output: Output }
    : never;
};

type EmptyMutationResolvers<AppRouter extends AnyRouter> = Record<
  never,
  MutationResolver<AppRouter>
>;

/**
 * Builds a `Transport` backed by a tRPC client using the configured resolvers
 * for by-id queries, lists, and mutations.
 */
export function createTRPCTransport<
  AppRouter extends AnyRouter,
  Mutations extends TRPCMutationResolvers<AppRouter> = EmptyMutationResolvers<AppRouter>,
>({
  byId,
  client,
  lists,
  mutations,
  queries,
}: {
  byId: TRPCByIdResolvers<AppRouter>;
  client: TRPCClient<AppRouter>;
  lists?: TRPCListResolvers<AppRouter>;
  mutations?: Mutations;
  queries?: TRPCQueryResolvers<AppRouter>;
}): Transport<MutationMapFromResolvers<Mutations>> {
  const transport: Transport<MutationMapFromResolvers<Mutations>> = {
    async fetchById(type, ids, select, args) {
      const resolver = byId[type];
      if (!resolver) {
        throw new Error(`fate(trpc): No 'byId' resolver configured for entity type '${type}'.`);
      }
      return await resolver(client)({
        args,
        ids,
        select: [...select],
      });
    },
    async fetchList(procedure, select, args) {
      if (!lists) {
        throw new Error(`fate(trpc): No list resolvers configured; cannot call "${procedure}".`);
      }
      const resolver = lists[procedure];
      if (!resolver) {
        throw new Error(`fate(trpc): Missing list resolver for procedure "${procedure}"`);
      }
      return resolver(client)({
        args,
        select: [...select],
      });
    },
    async fetchQuery(procedure, select, args) {
      if (!queries) {
        throw new Error(`fate(trpc): No query resolvers configured; cannot call "${procedure}".`);
      }

      const resolver = queries[procedure];
      if (!resolver) {
        throw new Error(`fate(trpc): Missing query resolver for procedure "${procedure}"`);
      }

      return resolver(client)({
        args,
        select: [...select],
      });
    },
  };

  transport.mutate = async <K extends Extract<keyof Mutations, string>>(
    procedure: K,
    input: MutationMapFromResolvers<Mutations>[K]['input'],
    select: Set<string>,
  ) => {
    const resolver = mutations?.[procedure];
    if (!resolver) {
      throw new Error(`fate(trpc): Missing mutation resolver for procedure '${procedure}'.`);
    }
    return await resolver(client)({
      ...(input as AnyRecord),
      select: [...select],
    });
  };

  return transport;
}
