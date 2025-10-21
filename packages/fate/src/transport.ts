import type { TRPCClient } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';
import { PageInfo } from './types.ts';

export interface Transport {
  fetchById(
    type: string,
    ids: Array<string | number>,
    select?: Array<string>,
  ): Promise<Array<unknown>>;
  fetchList?(
    proc: string,
    args: unknown,
    select?: Array<string>,
  ): Promise<{
    edges: Array<{ cursor: string; node: unknown }>;
    pageInfo: PageInfo;
  }>;
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
    input: { select?: Array<string> } & Record<string, unknown>,
  ) => Promise<{
    edges: Array<{ cursor: string; node: unknown }>;
    pageInfo: PageInfo;
  }>
>;

export function createFateTransport<AppRouter extends AnyRouter>(opts: {
  byId: TRPCByIdResolvers<AppRouter>;
  client: TRPCClient<AppRouter>;
  lists?: TRPCListResolvers<AppRouter>;
}): Transport {
  const { byId, client, lists } = opts;

  return {
    async fetchById(type, ids, select) {
      const resolver = byId[type];
      if (!resolver) {
        throw new Error(
          `fate(trpc): No 'byId' resolver configured for entity type '${type}'.`,
        );
      }
      const query = resolver(client);
      return await query({ ids, select });
    },
    async fetchList(proc, args, select) {
      if (!lists) {
        throw new Error(
          `fate(trpc): no list resolvers configured; cannot call "${proc}".`,
        );
      }
      const resolver = lists[proc];
      if (!resolver) {
        throw new Error(`fate(trpc): missing list resolver for proc "${proc}"`);
      }
      return resolver(client)({ ...(args as object), select });
    },
  };
}
