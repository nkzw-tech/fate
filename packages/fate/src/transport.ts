import type { TRPCClient } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';
import { AnyRecord, Pagination, type MutationShape } from './types.ts';

type TransportMutations = Record<string, MutationShape>;
type EmptyTransportMutations = Record<never, MutationShape>;

export interface Transport<
  Mutations extends TransportMutations = EmptyTransportMutations,
> {
  fetchById(
    type: string,
    ids: Array<string | number>,
    select?: Iterable<string>,
  ): Promise<Array<unknown>>;
  fetchList?(
    proc: string,
    args: unknown,
    select?: Iterable<string>,
  ): Promise<{
    items: Array<{ cursor: string | undefined; node: unknown }>;
    pagination: Pagination;
  }>;
  mutate?<K extends Extract<keyof Mutations, string>>(
    proc: K,
    input: Mutations[K]['input'],
    select?: Set<string>,
  ): Promise<Mutations[K]['output']>;
}

export type TRPCByIdResolvers<AppRouter extends AnyRouter> = Record<
  string,
  (
    client: TRPCClient<AppRouter>,
  ) => (input: {
    ids: Array<string | number>;
    select?: Array<string>;
  }) => Promise<Array<unknown>>
>;

export type TRPCListResolvers<AppRouter extends AnyRouter> = Record<
  string,
  (client: TRPCClient<AppRouter>) => (
    input: { select?: Array<string> } & AnyRecord,
  ) => Promise<{
    items: Array<{ cursor: string | undefined; node: unknown }>;
    pagination: Pagination;
  }>
>;

type MutationResolver<AppRouter extends AnyRouter> = (
  client: TRPCClient<AppRouter>,
) => (input: any) => Promise<any>;

export type TRPCMutationResolvers<AppRouter extends AnyRouter> = Record<
  string,
  MutationResolver<AppRouter>
>;

type MutationMapFromResolvers<R extends Record<string, MutationResolver<any>>> =
  {
    [K in keyof R]: R[K] extends (
      client: any,
    ) => (input: infer Input) => Promise<infer Output>
      ? { input: Input; output: Output }
      : never;
  };

type EmptyMutationResolvers<AppRouter extends AnyRouter> = Record<
  never,
  MutationResolver<AppRouter>
>;

export function createFateTransport<
  AppRouter extends AnyRouter,
  Mutations extends
    TRPCMutationResolvers<AppRouter> = EmptyMutationResolvers<AppRouter>,
>({
  byId,
  client,
  lists,
  mutations,
}: {
  byId: TRPCByIdResolvers<AppRouter>;
  client: TRPCClient<AppRouter>;
  lists?: TRPCListResolvers<AppRouter>;
  mutations?: Mutations;
}): Transport<MutationMapFromResolvers<Mutations>> {
  const transport: Transport<MutationMapFromResolvers<Mutations>> = {
    async fetchById(type, ids, select) {
      const resolver = byId[type];
      if (!resolver) {
        throw new Error(
          `fate(trpc): No 'byId' resolver configured for entity type '${type}'.`,
        );
      }
      return await resolver(client)({
        ids,
        select: select ? [...select] : undefined,
      });
    },
    async fetchList(procedure, args, select) {
      if (!lists) {
        throw new Error(
          `fate(trpc): No list resolvers configured; cannot call "${procedure}".`,
        );
      }
      const resolver = lists[procedure];
      if (!resolver) {
        throw new Error(
          `fate(trpc): Missing list resolver for procedure "${procedure}"`,
        );
      }
      return resolver(client)({
        ...(args as object),
        select: select ? [...select] : undefined,
      });
    },
  };

  if (mutations) {
    transport.mutate = async <K extends Extract<keyof Mutations, string>>(
      procedure: K,
      input: MutationMapFromResolvers<Mutations>[K]['input'],
      select?: Set<string>,
    ) => {
      const resolver = mutations[procedure];
      if (!resolver) {
        throw new Error(
          `fate(trpc): Missing mutation resolver for procedure '${procedure}'.`,
        );
      }
      return await resolver(client)({
        ...(input as AnyRecord),
        select: select ? [...select] : undefined,
      });
    };
  }

  return transport;
}
