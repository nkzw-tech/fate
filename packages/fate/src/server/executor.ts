import type { AnyRecord } from '../types.ts';
import { createExecutionPlan, type ExecutionPlan, type SourceDefinition } from './source.ts';

export type SourceConnectionHandler<
  Context,
  Extra = unknown,
  Item extends AnyRecord = AnyRecord,
> = (options: {
  ctx: Context;
  cursor?: string;
  direction: 'backward' | 'forward';
  extra?: Extra;
  plan: ExecutionPlan<Item, Context>;
  skip?: number;
  take: number;
}) => Promise<Array<Item>>;

export type SourceByIdHandler<
  Context,
  Extra = unknown,
  Item extends AnyRecord = AnyRecord,
> = (options: {
  ctx: Context;
  extra?: Extra;
  id: string;
  plan: ExecutionPlan<Item, Context>;
}) => Promise<Item | null>;

export type SourceByIdsHandler<
  Context,
  Extra = unknown,
  Item extends AnyRecord = AnyRecord,
> = (options: {
  ctx: Context;
  extra?: Extra;
  ids: Array<string>;
  plan: ExecutionPlan<Item, Context>;
}) => Promise<Array<Item>>;

export type SourceExecutor<
  Context,
  Item extends AnyRecord = AnyRecord,
  ByIdExtra = unknown,
  ByIdsExtra = unknown,
  ConnectionExtra = unknown,
> = {
  byId?: SourceByIdHandler<Context, ByIdExtra, Item>;
  byIds?: SourceByIdsHandler<Context, ByIdsExtra, Item>;
  connection?: SourceConnectionHandler<Context, ConnectionExtra, Item>;
};

export type SourceRegistry<Context> = Map<
  SourceDefinition<AnyRecord, unknown>,
  SourceExecutor<Context, AnyRecord, any, any, any>
>;

export const createSourceRegistry = <Context>(
  entries: Array<
    [SourceDefinition<AnyRecord, unknown>, SourceExecutor<Context, AnyRecord, any, any, any>]
  >,
): SourceRegistry<Context> => new Map(entries);

const getSourceExecutor = <Context, Item extends AnyRecord>({
  plan,
  registry,
}: {
  plan: ExecutionPlan<Item, Context>;
  registry: SourceRegistry<Context>;
}) => {
  const executor = registry.get(plan.source as SourceDefinition<AnyRecord, unknown>);

  if (!executor) {
    throw new Error(`No executor registered for source ${plan.source.view.typeName}.`);
  }

  return executor;
};

export const executeSourceByIds = async <Context, Item extends AnyRecord>({
  ctx,
  extra,
  ids,
  plan,
  registry,
}: {
  ctx: Context;
  extra?: unknown;
  ids: Array<string>;
  plan: ExecutionPlan<Item, Context>;
  registry: SourceRegistry<Context>;
}) => {
  const executor = getSourceExecutor({ plan, registry });
  const planRecord = plan as ExecutionPlan<AnyRecord, Context>;

  if (executor.byIds) {
    return plan.resolveMany(await executor.byIds({ ctx, extra, ids, plan: planRecord }));
  }

  if (!executor.byId) {
    throw new Error(`Source ${plan.source.view.typeName} does not support byIds execution.`);
  }

  const items = await Promise.all(
    ids.map((id) => executor.byId?.({ ctx, extra, id, plan: planRecord })),
  );
  return plan.resolveMany(items.flatMap((item) => (item ? [item] : [])));
};

export const executeSourceById = async <Context, Item extends AnyRecord>({
  ctx,
  extra,
  id,
  plan,
  registry,
}: {
  ctx: Context;
  extra?: unknown;
  id: string;
  plan: ExecutionPlan<Item, Context>;
  registry: SourceRegistry<Context>;
}) => {
  const executor = getSourceExecutor({ plan, registry });
  const planRecord = plan as ExecutionPlan<AnyRecord, Context>;

  if (executor.byId) {
    const item = await executor.byId({ ctx, extra, id, plan: planRecord });
    return item ? plan.resolve(item as Item) : null;
  }

  if (!executor.byIds) {
    throw new Error(`Source ${plan.source.view.typeName} does not support byId execution.`);
  }

  const items = await executor.byIds({ ctx, extra, ids: [id], plan: planRecord });
  return items[0] ? plan.resolve(items[0] as Item) : null;
};

export const executeSourceConnection = async <Context, Item extends AnyRecord>({
  ctx,
  cursor,
  direction,
  extra,
  plan,
  registry,
  skip,
  take,
}: {
  ctx: Context;
  cursor?: string;
  direction: 'backward' | 'forward';
  extra?: unknown;
  plan: ExecutionPlan<Item, Context>;
  registry: SourceRegistry<Context>;
  skip?: number;
  take: number;
}) => {
  const executor = getSourceExecutor({ plan, registry });
  const planRecord = plan as ExecutionPlan<AnyRecord, Context>;

  if (!executor.connection) {
    throw new Error(`Source ${plan.source.view.typeName} does not support connection execution.`);
  }

  return plan.resolveMany(
    await executor.connection({
      ctx,
      cursor,
      direction,
      extra,
      plan: planRecord,
      skip,
      take,
    }),
  );
};

export const refetchSourceById = async <Context, Item extends AnyRecord>({
  ctx,
  extra,
  id,
  input,
  registry,
  source,
}: {
  ctx: Context;
  extra?: unknown;
  id: string;
  input: {
    args?: Record<string, unknown>;
    select: Iterable<string>;
  };
  registry: SourceRegistry<Context>;
  source: SourceDefinition<Item, unknown>;
}) =>
  executeSourceById({
    ctx,
    extra,
    id,
    plan: createExecutionPlan({ ...input, ctx, source }),
    registry,
  });
