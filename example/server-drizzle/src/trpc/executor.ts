import {
  createSourceRegistry,
  type ExecutionPlan,
  type SourceDefinition,
  type SourceExecutor,
} from '@nkzw/fate/server';
import {
  fetchCategoriesByIds,
  fetchCategoriesConnection,
  fetchCommentById,
  fetchCommentsByIds,
  fetchEventsByIds,
  fetchEventsConnection,
  fetchPostById,
  fetchPostsByIds,
  fetchPostsConnection,
  fetchTagById,
  fetchTagsByIds,
  fetchUserById,
  fetchUsersByIds,
} from '../drizzle/queries.ts';
import type { AppContext } from './context.ts';
import {
  categorySource,
  commentSource,
  eventSource,
  postSource,
  tagSource,
  userSource,
} from './views.ts';

type SourceItem = Record<string, unknown>;

const connectionExecutor = <
  Item extends SourceItem = SourceItem,
  Plan extends ExecutionPlan<Item, AppContext> = ExecutionPlan<Item, AppContext>,
>(options: {
  byId: (id: string, plan: Plan) => Promise<Item | null>;
  byIds: (ids: Array<string>, plan: Plan) => Promise<Array<Item>>;
  connection?: (args: {
    cursor?: string;
    direction: 'backward' | 'forward';
    plan: Plan;
    take: number;
  }) => Promise<Array<Item>>;
}): SourceExecutor<AppContext, SourceItem> => ({
  byId: async ({ id, plan }: { id: string; plan: ExecutionPlan<SourceItem, AppContext> }) =>
    options.byId(id, plan as Plan),
  byIds: async ({
    ids,
    plan,
  }: {
    ids: Array<string>;
    plan: ExecutionPlan<SourceItem, AppContext>;
  }) => options.byIds(ids, plan as Plan),
  connection: options.connection
    ? async ({
        cursor,
        direction,
        plan,
        take,
      }: {
        cursor?: string;
        direction: 'backward' | 'forward';
        plan: ExecutionPlan<SourceItem, AppContext>;
        take: number;
      }) => options.connection?.({ cursor, direction, plan: plan as Plan, take }) ?? []
    : undefined,
});

export const drizzleRegistry = createSourceRegistry<AppContext>([
  [
    categorySource as SourceDefinition<SourceItem, unknown>,
    connectionExecutor({
      byId: async (id, plan) => (await fetchCategoriesByIds([id], plan.root))[0] ?? null,
      byIds: async (ids, plan) => fetchCategoriesByIds(ids, plan.root),
      connection: async ({ cursor, direction, plan, take }) =>
        fetchCategoriesConnection({ cursor, direction, node: plan.root, take }),
    }),
  ],
  [
    commentSource as SourceDefinition<SourceItem, unknown>,
    connectionExecutor({
      byId: async (id, plan) => fetchCommentById(id, plan.root),
      byIds: async (ids, plan) => fetchCommentsByIds(ids, plan.root),
    }),
  ],
  [
    eventSource as SourceDefinition<SourceItem, unknown>,
    connectionExecutor({
      byId: async (id, plan) => (await fetchEventsByIds([id], plan.root))[0] ?? null,
      byIds: async (ids, plan) => fetchEventsByIds(ids, plan.root),
      connection: async ({ cursor, direction, plan, take }) =>
        fetchEventsConnection({ cursor, direction, node: plan.root, take }),
    }),
  ],
  [
    postSource as SourceDefinition<SourceItem, unknown>,
    connectionExecutor({
      byId: async (id, plan) => fetchPostById(id, plan.root),
      byIds: async (ids, plan) => fetchPostsByIds(ids, plan.root),
      connection: async ({ cursor, direction, plan, take }) =>
        fetchPostsConnection({ cursor, direction, node: plan.root, take }),
    }),
  ],
  [
    tagSource as SourceDefinition<SourceItem, unknown>,
    connectionExecutor({
      byId: async (id, plan) => fetchTagById(id, plan.root),
      byIds: async (ids, plan) => fetchTagsByIds(ids, plan.root),
    }),
  ],
  [
    userSource as SourceDefinition<SourceItem, unknown>,
    connectionExecutor({
      byId: async (id, plan) => fetchUserById(id, plan.root),
      byIds: async (ids, plan) => fetchUsersByIds(ids, plan.root),
    }),
  ],
]);
