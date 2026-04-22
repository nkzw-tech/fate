import { createExecutionPlan, type ExecutionPlan, type SourceDefinition } from '@nkzw/fate/server';
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
  getTagsByIds,
  getUserById,
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

type Source = SourceDefinition<Record<string, unknown>>;

type SourceExecutor = {
  byId?: (
    id: string,
    node: ExecutionPlan<Record<string, unknown>>['root'],
  ) => Promise<Record<string, unknown> | null>;
  byIds?: (
    ids: Array<string>,
    node: ExecutionPlan<Record<string, unknown>>['root'],
  ) => Promise<Array<Record<string, unknown>>>;
  connection?: (options: {
    cursor?: string;
    direction: 'backward' | 'forward';
    node: ExecutionPlan<Record<string, unknown>>['root'];
    take: number;
  }) => Promise<Array<Record<string, unknown>>>;
};

const executors = new Map<Source, SourceExecutor>([
  [
    categorySource,
    {
      byId: async (id, node) => (await fetchCategoriesByIds([id], node))[0] ?? null,
      byIds: fetchCategoriesByIds,
      connection: fetchCategoriesConnection,
    },
  ],
  [
    commentSource,
    {
      byId: fetchCommentById,
      byIds: fetchCommentsByIds,
    },
  ],
  [
    eventSource,
    {
      byId: async (id, node) => (await fetchEventsByIds([id], node))[0] ?? null,
      byIds: fetchEventsByIds,
      connection: fetchEventsConnection,
    },
  ],
  [
    postSource,
    {
      byId: fetchPostById,
      byIds: fetchPostsByIds,
      connection: fetchPostsConnection,
    },
  ],
  [
    tagSource,
    {
      byId: async (id) => (await getTagsByIds([id]))[0] ?? null,
      byIds: getTagsByIds,
    },
  ],
  [
    userSource,
    {
      byId: getUserById,
      byIds: async (ids) =>
        (
          await Promise.all(
            ids.map(async (id) => {
              const user = await getUserById(id);
              return user ? [user] : [];
            }),
          )
        ).flat(),
    },
  ],
]);

const getExecutor = (source: Source) => {
  const executor = executors.get(source);

  if (!executor) {
    throw new Error(`No Drizzle executor registered for source ${source.view.typeName}.`);
  }

  return executor;
};

export const createDrizzlePlan = <TSource extends Source>({
  ctx,
  input,
  source,
}: {
  ctx: AppContext;
  input: {
    args?: Record<string, unknown>;
    select: Array<string>;
  };
  source: TSource;
}) =>
  createExecutionPlan({
    ...input,
    ctx,
    source,
  });

export const executeDrizzleByIds = async ({
  ids,
  plan,
}: {
  ids: Array<string>;
  plan: ExecutionPlan<any>;
}) => {
  const byIds = getExecutor(plan.source).byIds;
  if (!byIds) {
    throw new Error(`Source ${plan.source.view.typeName} does not support byIds execution.`);
  }

  return plan.resolveMany(await byIds(ids, plan.root));
};

export const executeDrizzleById = async ({
  id,
  plan,
}: {
  id: string;
  plan: ExecutionPlan<any>;
}) => {
  const byId = getExecutor(plan.source).byId;
  if (!byId) {
    throw new Error(`Source ${plan.source.view.typeName} does not support byId execution.`);
  }

  const item = await byId(id, plan.root);
  return item ? plan.resolve(item) : null;
};

export const executeDrizzleConnection = async ({
  cursor,
  direction,
  plan,
  take,
}: {
  cursor?: string;
  direction: 'backward' | 'forward';
  plan: ExecutionPlan<any>;
  take: number;
}) => {
  const connection = getExecutor(plan.source).connection;
  if (!connection) {
    throw new Error(`Source ${plan.source.view.typeName} does not support connection execution.`);
  }

  return plan.resolveMany(await connection({ cursor, direction, node: plan.root, take }));
};
