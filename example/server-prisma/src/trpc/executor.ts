import {
  createSourceRegistry,
  toPrismaSelect,
  type ExecutionPlan,
  type SourceDefinition,
  type SourceExecutor,
} from '@nkzw/fate/server';
import { attachConflictingComputedCounts } from './computedCounts.ts';
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

type PrismaDelegate = {
  findMany: (args: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  findUnique: (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  groupBy?: (args: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
};

type PrismaQueryExtra = Record<string, unknown>;
type RegisteredPrismaSource =
  | typeof categorySource
  | typeof commentSource
  | typeof eventSource
  | typeof postSource
  | typeof tagSource
  | typeof userSource;

const getDelegate = (ctx: AppContext, source: RegisteredPrismaSource): PrismaDelegate => {
  if (source === categorySource) {
    return ctx.prisma.category as unknown as PrismaDelegate;
  }
  if (source === commentSource) {
    return ctx.prisma.comment as unknown as PrismaDelegate;
  }
  if (source === eventSource) {
    return ctx.prisma.event as unknown as PrismaDelegate;
  }
  if (source === postSource) {
    return ctx.prisma.post as unknown as PrismaDelegate;
  }
  if (source === tagSource) {
    return ctx.prisma.tag as unknown as PrismaDelegate;
  }
  if (source === userSource) {
    return ctx.prisma.user as unknown as PrismaDelegate;
  }

  throw new Error(`No Prisma delegate registered for source ${source.view.typeName}.`);
};

type SourceItem = Record<string, unknown>;

const attachComputedCounts = async ({
  ctx,
  items,
  plan,
}: {
  ctx: AppContext;
  items: Array<SourceItem>;
  plan: ExecutionPlan<SourceItem, AppContext>;
}) =>
  attachConflictingComputedCounts({
    ctx,
    getDelegate: (context, source) => getDelegate(context, source as RegisteredPrismaSource),
    items,
    node: plan.root,
    source: plan.source as SourceDefinition<SourceItem, unknown>,
  });

const findManyExecutor = (): SourceExecutor<
  AppContext,
  SourceItem,
  PrismaQueryExtra,
  PrismaQueryExtra,
  PrismaQueryExtra
> => ({
  byIds: async ({
    ctx,
    extra,
    ids,
    plan,
  }: {
    ctx: AppContext;
    extra?: PrismaQueryExtra;
    ids: Array<string>;
    plan: ExecutionPlan<SourceItem, AppContext>;
  }) =>
    attachComputedCounts({
      ctx,
      items: await getDelegate(ctx, plan.source as RegisteredPrismaSource).findMany({
        ...extra,
        select: toPrismaSelect(plan),
        where: { id: { in: ids } },
      }),
      plan,
    }),
  connection: async ({
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
    extra?: PrismaQueryExtra;
    plan: ExecutionPlan<SourceItem, AppContext>;
    skip?: number;
    take: number;
  }) => {
    const items = await getDelegate(ctx, plan.source as RegisteredPrismaSource).findMany({
      ...extra,
      ...prismaConnectionArgs({ cursor, direction, node: plan.root, skip, take }),
      select: toPrismaSelect(plan),
    });
    const hydrated = await attachComputedCounts({ ctx, items, plan });

    return direction === 'backward' ? [...hydrated].reverse() : hydrated;
  },
});

const findUniqueExecutor = (): SourceExecutor<
  AppContext,
  SourceItem,
  PrismaQueryExtra,
  PrismaQueryExtra,
  PrismaQueryExtra
> => ({
  byId: async ({
    ctx,
    extra,
    id,
    plan,
  }: {
    ctx: AppContext;
    extra?: PrismaQueryExtra;
    id: string;
    plan: ExecutionPlan<SourceItem, AppContext>;
  }) =>
    (
      await attachComputedCounts({
        ctx,
        items: (
          await Promise.all([
            getDelegate(ctx, plan.source as RegisteredPrismaSource).findUnique({
              ...extra,
              select: toPrismaSelect(plan),
              where: { id },
            }),
          ])
        ).flatMap((item) => (item ? [item] : [])),
        plan,
      })
    )[0] ?? null,
});

export const prismaRegistry = createSourceRegistry<AppContext>([
  [categorySource as SourceDefinition<SourceItem, unknown>, findManyExecutor()],
  [commentSource as SourceDefinition<SourceItem, unknown>, findManyExecutor()],
  [eventSource as SourceDefinition<SourceItem, unknown>, findManyExecutor()],
  [postSource as SourceDefinition<SourceItem, unknown>, findManyExecutor()],
  [
    tagSource as SourceDefinition<SourceItem, unknown>,
    {
      byIds: async ({
        ctx,
        extra,
        ids,
        plan,
      }: {
        ctx: AppContext;
        extra?: PrismaQueryExtra;
        ids: Array<string>;
        plan: ExecutionPlan<SourceItem, AppContext>;
      }) =>
        attachComputedCounts({
          ctx,
          items: await getDelegate(ctx, plan.source as RegisteredPrismaSource).findMany({
            ...extra,
            select: toPrismaSelect(plan),
            where: { id: { in: ids } },
          }),
          plan,
        }),
    },
  ],
  [userSource as SourceDefinition<SourceItem, unknown>, findUniqueExecutor()],
]);
