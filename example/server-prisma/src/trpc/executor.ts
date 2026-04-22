import {
  createExecutionPlan,
  type ExecutionPlan,
  type SourceDefinition,
  toPrismaSelect,
} from '@nkzw/fate/server';
import type { AppContext } from './context.ts';
import { prismaConnectionArgs } from './source.ts';
import {
  categorySource,
  commentSource,
  eventSource,
  postSource,
  tagSource,
  userSource,
} from './views.ts';

type Source = SourceDefinition<Record<string, unknown>>;

type PrismaDelegate = {
  findMany: (args: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  findUnique: (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  findUniqueOrThrow?: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

const delegates = new Map<Source, (ctx: AppContext) => PrismaDelegate>([
  [categorySource, (ctx) => ctx.prisma.category as unknown as PrismaDelegate],
  [commentSource, (ctx) => ctx.prisma.comment as unknown as PrismaDelegate],
  [eventSource, (ctx) => ctx.prisma.event as unknown as PrismaDelegate],
  [postSource, (ctx) => ctx.prisma.post as unknown as PrismaDelegate],
  [tagSource, (ctx) => ctx.prisma.tag as unknown as PrismaDelegate],
  [userSource, (ctx) => ctx.prisma.user as unknown as PrismaDelegate],
]);

const getDelegate = (ctx: AppContext, source: Source) => {
  const delegate = delegates.get(source);

  if (!delegate) {
    throw new Error(`No Prisma delegate registered for source ${source.view.typeName}.`);
  }

  return delegate(ctx);
};

export const createPrismaPlan = <TSource extends Source>({
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

export const executePrismaByIds = async ({
  ctx,
  extra,
  ids,
  plan,
}: {
  ctx: AppContext;
  extra?: Record<string, unknown>;
  ids: Array<string>;
  plan: ExecutionPlan<Record<string, unknown>>;
}) =>
  plan.resolveMany(
    await getDelegate(ctx, plan.source).findMany({
      ...extra,
      select: toPrismaSelect(plan),
      where: { id: { in: ids } },
    }),
  );

export const executePrismaConnection = async ({
  ctx,
  cursor,
  direction,
  extra,
  plan,
  skip,
  take,
}: {
  ctx: AppContext;
  cursor?: string;
  direction: 'backward' | 'forward';
  extra?: Record<string, unknown>;
  plan: ExecutionPlan<Record<string, unknown>>;
  skip?: number;
  take: number;
}) => {
  const items = await getDelegate(ctx, plan.source).findMany({
    ...extra,
    ...prismaConnectionArgs({ cursor, direction, node: plan.root, skip, take }),
    select: toPrismaSelect(plan),
  });

  return plan.resolveMany(direction === 'forward' ? items : items.reverse());
};

export const executePrismaById = async ({
  ctx,
  extra,
  id,
  plan,
}: {
  ctx: AppContext;
  extra?: Record<string, unknown>;
  id: string;
  plan: ExecutionPlan<Record<string, unknown>>;
}) => {
  const item = await getDelegate(ctx, plan.source).findUnique({
    ...extra,
    select: toPrismaSelect(plan),
    where: { id },
  });

  return item ? plan.resolve(item) : null;
};
