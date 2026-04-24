import type { AnyRecord } from '../types.ts';
import { createSourcePlan, type SourcePlan, type SourceDefinition } from './source.ts';

export type SourceConnectionHandler<
  Context,
  Extra = unknown,
  Item extends AnyRecord = AnyRecord,
> = (options: {
  ctx: Context;
  cursor?: string;
  direction: 'backward' | 'forward';
  extra?: Extra;
  plan: SourcePlan<Item, Context>;
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
  plan: SourcePlan<Item, Context>;
}) => Promise<Item | null>;

export type SourceByIdsHandler<
  Context,
  Extra = unknown,
  Item extends AnyRecord = AnyRecord,
> = (options: {
  ctx: Context;
  extra?: Extra;
  ids: Array<string>;
  plan: SourcePlan<Item, Context>;
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
  plan: SourcePlan<Item, Context>;
  registry: SourceRegistry<Context>;
}) => {
  const executor = registry.get(plan.source as SourceDefinition<AnyRecord, unknown>);

  if (!executor) {
    throw new Error(`No executor registered for source ${plan.source.view.typeName}.`);
  }

  return executor;
};

const createPlan = <Context, Item extends AnyRecord>({
  ctx,
  input,
  source,
}: {
  ctx: Context;
  input: {
    args?: Record<string, unknown>;
    select: Iterable<string>;
  };
  source: SourceDefinition<Item, unknown>;
}) => createSourcePlan({ ...input, ctx, source });

export const resolveSourceByIds = async <Context, Item extends AnyRecord>({
  ctx,
  extra,
  ids,
  input,
  registry,
  source,
}: {
  ctx: Context;
  extra?: unknown;
  ids: Array<string>;
  input: {
    args?: Record<string, unknown>;
    select: Iterable<string>;
  };
  registry: SourceRegistry<Context>;
  source: SourceDefinition<Item, unknown>;
}) => {
  const plan = createPlan({ ctx, input, source });
  const executor = getSourceExecutor({ plan, registry });
  const planRecord = plan as SourcePlan<AnyRecord, Context>;

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

export const resolveSourceById = async <Context, Item extends AnyRecord>({
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
}) => {
  const plan = createPlan({ ctx, input, source });
  const executor = getSourceExecutor({ plan, registry });
  const planRecord = plan as SourcePlan<AnyRecord, Context>;

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

export const resolveSourceConnection = async <Context, Item extends AnyRecord>({
  ctx,
  cursor,
  direction,
  extra,
  input,
  registry,
  skip,
  source,
  take,
}: {
  ctx: Context;
  cursor?: string;
  direction: 'backward' | 'forward';
  extra?: unknown;
  input: {
    args?: Record<string, unknown>;
    select: Iterable<string>;
  };
  registry: SourceRegistry<Context>;
  skip?: number;
  source: SourceDefinition<Item, unknown>;
  take: number;
}) => {
  const plan = createPlan({ ctx, input, source });
  const executor = getSourceExecutor({ plan, registry });
  const planRecord = plan as SourcePlan<AnyRecord, Context>;

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
  resolveSourceById({
    ctx,
    extra,
    id,
    input,
    registry,
    source,
  });
