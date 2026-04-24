/**
 * The fate Prisma source adapter.
 *
 * @example
 * import { createPrismaSourceAdapter } from '@nkzw/fate/server/prisma';
 *
 * @module @nkzw/fate/server/prisma
 */

import type { AnyRecord } from '../types.ts';
import { attachComputedState } from './dataView.ts';
import { createSourceRegistry, type SourceRegistry } from './executor.ts';
import { toPrismaSelect } from './prismaSelect.ts';
import type { SourcePlan, SourcePlanNode, SourceDefinition, SourceOrder } from './source.ts';

type Source = SourceDefinition<AnyRecord, unknown>;

export type PrismaDelegate = {
  findMany?: (args: any) => Promise<Array<AnyRecord>>;
  findUnique?: (args: any) => Promise<AnyRecord | null>;
  groupBy?: (args: any) => Promise<Array<AnyRecord>>;
};

export type PrismaQueryExtra = AnyRecord;

export type PrismaSourceConfig<Context, Item extends AnyRecord = AnyRecord> = {
  delegate: (ctx: Context) => unknown;
  source: SourceDefinition<Item, unknown>;
};

export type PrismaSourceAdapter<Context> = {
  fetchById: <Item extends AnyRecord = AnyRecord>({
    ctx,
    extra,
    id,
    plan,
  }: {
    ctx: Context;
    extra?: PrismaQueryExtra;
    id: string;
    plan: SourcePlan<Item, Context>;
  }) => Promise<Item | null>;
  fetchByIds: <Item extends AnyRecord = AnyRecord>({
    ctx,
    extra,
    ids,
    plan,
  }: {
    ctx: Context;
    extra?: PrismaQueryExtra;
    ids: Array<string>;
    plan: SourcePlan<Item, Context>;
  }) => Promise<Array<Item>>;
  fetchConnection: <Item extends AnyRecord = AnyRecord>({
    ctx,
    cursor,
    direction,
    extra,
    plan,
    skip,
    take,
  }: {
    ctx: Context;
    cursor?: string;
    direction: 'backward' | 'forward';
    extra?: PrismaQueryExtra;
    plan: SourcePlan<Item, Context>;
    skip?: number;
    take: number;
  }) => Promise<Array<Item>>;
  registry: SourceRegistry<Context>;
};

type CountRequest = {
  field: string;
  needName: string;
  relation: string;
  where?: AnyRecord;
};

const isRecord = (value: unknown): value is AnyRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

const resolveSourceReference = (source: Source | (() => Source)) =>
  typeof source === 'function' ? source() : source;

const toPrismaOrderBy = (orderBy: SourceOrder) =>
  orderBy.map((entry) => ({ [entry.field]: entry.direction }));

export const prismaConnectionArgs = ({
  cursor,
  direction,
  node,
  skip,
  take,
}: {
  cursor?: string;
  direction: 'backward' | 'forward';
  node: SourcePlanNode<any, any>;
  skip?: number;
  take: number;
}) => ({
  ...(cursor
    ? {
        cursor: { id: cursor },
        skip,
      }
    : null),
  orderBy: toPrismaOrderBy(node.orderBy),
  take: direction === 'forward' ? take : -take,
});

const getConflictingCountRequests = <Context>(
  node: SourcePlanNode<Context>,
): Map<string, Array<CountRequest>> => {
  const signaturesByRelation = new Map<string, Set<string>>();
  const requestsByRelation = new Map<string, Array<CountRequest>>();

  for (const [field, computed] of node.computeds) {
    if (!computed.needs) {
      continue;
    }

    for (const [needName, need] of Object.entries(computed.needs)) {
      if (need.kind !== 'count') {
        continue;
      }

      const signature = stableStringify(need.where ?? null);
      const signatures = signaturesByRelation.get(need.relation) ?? new Set<string>();
      signatures.add(signature);
      signaturesByRelation.set(need.relation, signatures);

      const requests = requestsByRelation.get(need.relation) ?? [];
      requests.push({ field, needName, relation: need.relation, where: need.where });
      requestsByRelation.set(need.relation, requests);
    }
  }

  return new Map(
    [...requestsByRelation.entries()].filter(
      ([relation]) => (signaturesByRelation.get(relation)?.size ?? 0) > 1,
    ),
  );
};

export function createPrismaSourceAdapter<Context>({
  sources,
}: {
  sources: Array<PrismaSourceConfig<Context, AnyRecord>>;
}): PrismaSourceAdapter<Context> {
  const delegates = new Map<Source, (ctx: Context) => PrismaDelegate>(
    sources.map((source) => [
      source.source as Source,
      (ctx: Context) => source.delegate(ctx) as PrismaDelegate,
    ]),
  );

  const getDelegate = (ctx: Context, source: Source): PrismaDelegate => {
    const getSourceDelegate = delegates.get(source);
    if (!getSourceDelegate) {
      throw new Error(`No Prisma delegate registered for source ${source.view.typeName}.`);
    }
    return getSourceDelegate(ctx);
  };

  const countChildrenByParentKey = async ({
    ctx,
    foreignKey,
    parentKeys,
    source,
    where,
  }: {
    ctx: Context;
    foreignKey: string;
    parentKeys: Array<unknown>;
    source: Source;
    where?: AnyRecord;
  }) => {
    const delegate = getDelegate(ctx, source);

    if (!delegate.groupBy) {
      throw new Error(`Source ${source.view.typeName} does not support grouped count hydration.`);
    }

    const rows = await delegate.groupBy({
      _count: { _all: true },
      by: [foreignKey],
      where: {
        [foreignKey]: { in: parentKeys },
        ...(where ?? {}),
      },
    });

    return new Map(
      rows.map((row) => [
        row[foreignKey],
        (((row._count as AnyRecord | undefined)?._all as number | undefined) ?? 0) as number,
      ]),
    );
  };

  const attachConflictingComputedCounts = async ({
    ctx,
    items,
    node,
    source,
  }: {
    ctx: Context;
    items: Array<AnyRecord>;
    node: SourcePlanNode<Context>;
    source: Source;
  }): Promise<Array<AnyRecord>> => {
    if (items.length === 0) {
      return items;
    }

    const conflictingRequests = getConflictingCountRequests(node);

    for (const [relationName, requests] of conflictingRequests) {
      const relation = source.relations?.[relationName];

      if (!relation || relation.kind !== 'many') {
        throw new Error(
          `Conflicting computed counts on ${source.view.typeName}.${relationName} require a 'many' relation in the Prisma executor.`,
        );
      }

      const childSource = resolveSourceReference(relation.source);
      const parentKeys = [...new Set(items.map((item) => item[relation.localKey]).filter(Boolean))];
      const assignmentsBySignature = new Map<
        string,
        { requests: Array<CountRequest>; where?: AnyRecord }
      >();

      for (const request of requests) {
        const signature = stableStringify(request.where ?? null);
        const assignment = assignmentsBySignature.get(signature) ?? {
          requests: [],
          where: request.where,
        };
        assignment.requests.push(request);
        assignmentsBySignature.set(signature, assignment);
      }

      for (const { requests: signatureRequests, where } of assignmentsBySignature.values()) {
        const counts = await countChildrenByParentKey({
          ctx,
          foreignKey: relation.foreignKey,
          parentKeys,
          source: childSource,
          where,
        });

        for (const item of items) {
          const parentKey = item[relation.localKey];
          const count = counts.get(parentKey) ?? 0;

          for (const request of signatureRequests) {
            attachComputedState(item, request.field, {
              [request.needName]: count,
            });
          }
        }
      }
    }

    for (const [relationName, relationNode] of node.relations) {
      const relation = source.relations?.[relationName];
      if (!relation) {
        continue;
      }

      const childSource = resolveSourceReference(relation.source);
      const childItems = items.flatMap((item) => {
        const value = item[relationName];
        if (Array.isArray(value)) {
          return value.filter(isRecord);
        }
        return isRecord(value) ? [value] : [];
      });

      await attachConflictingComputedCounts({
        ctx,
        items: childItems,
        node: relationNode,
        source: childSource,
      });
    }

    return items;
  };

  const hydrateComputedCounts = async <Item extends AnyRecord>({
    ctx,
    items,
    plan,
  }: {
    ctx: Context;
    items: Array<AnyRecord>;
    plan: SourcePlan<Item, Context>;
  }) =>
    attachConflictingComputedCounts({
      ctx,
      items,
      node: plan.root,
      source: plan.source as Source,
    });

  const fetchByIds = async <Item extends AnyRecord>({
    ctx,
    extra,
    ids,
    plan,
  }: {
    ctx: Context;
    extra?: PrismaQueryExtra;
    ids: Array<string>;
    plan: SourcePlan<Item, Context>;
  }) => {
    const delegate = getDelegate(ctx, plan.source as Source);

    if (!delegate.findMany) {
      throw new Error(`Source ${plan.source.view.typeName} does not support byIds execution.`);
    }

    return hydrateComputedCounts({
      ctx,
      items: await delegate.findMany({
        ...extra,
        select: toPrismaSelect(plan),
        where: { id: { in: ids } },
      }),
      plan,
    }) as Promise<Array<Item>>;
  };

  const fetchById = async <Item extends AnyRecord>({
    ctx,
    extra,
    id,
    plan,
  }: {
    ctx: Context;
    extra?: PrismaQueryExtra;
    id: string;
    plan: SourcePlan<Item, Context>;
  }) => {
    const delegate = getDelegate(ctx, plan.source as Source);

    if (delegate.findUnique) {
      return (
        (
          (await hydrateComputedCounts({
            ctx,
            items: (
              await Promise.all([
                delegate.findUnique({
                  ...extra,
                  select: toPrismaSelect(plan),
                  where: { id },
                }),
              ])
            ).flatMap((item) => (item ? [item] : [])),
            plan,
          })) as Array<Item>
        )[0] ?? null
      );
    }

    return (await fetchByIds({ ctx, extra, ids: [id], plan }))[0] ?? null;
  };

  const fetchConnection = async <Item extends AnyRecord>({
    ctx,
    cursor,
    direction,
    extra,
    plan,
    skip,
    take,
  }: {
    ctx: Context;
    cursor?: string;
    direction: 'backward' | 'forward';
    extra?: PrismaQueryExtra;
    plan: SourcePlan<Item, Context>;
    skip?: number;
    take: number;
  }) => {
    const delegate = getDelegate(ctx, plan.source as Source);

    if (!delegate.findMany) {
      throw new Error(`Source ${plan.source.view.typeName} does not support connection execution.`);
    }

    const hydrated = await hydrateComputedCounts({
      ctx,
      items: await delegate.findMany({
        ...extra,
        ...prismaConnectionArgs({ cursor, direction, node: plan.root, skip, take }),
        select: toPrismaSelect(plan),
      }),
      plan,
    });

    return (direction === 'backward' ? [...hydrated].reverse() : hydrated) as Array<Item>;
  };

  const registry = createSourceRegistry<Context>(
    sources.map((source) => [
      source.source as Source,
      {
        byId: ({ ctx, extra, id, plan }) =>
          fetchById({ ctx, extra: extra as PrismaQueryExtra | undefined, id, plan }),
        byIds: ({ ctx, extra, ids, plan }) =>
          fetchByIds({ ctx, extra: extra as PrismaQueryExtra | undefined, ids, plan }),
        connection: ({ ctx, cursor, direction, extra, plan, skip, take }) =>
          fetchConnection({
            ctx,
            cursor,
            direction,
            extra: extra as PrismaQueryExtra | undefined,
            plan,
            skip,
            take,
          }),
      },
    ]),
  );

  return {
    fetchById,
    fetchByIds,
    fetchConnection,
    registry,
  };
}

export const createPrismaSourceRegistry = <Context>(
  options: Parameters<typeof createPrismaSourceAdapter<Context>>[0],
) => createPrismaSourceAdapter<Context>(options).registry;
