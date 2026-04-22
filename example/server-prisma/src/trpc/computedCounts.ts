import {
  attachComputedState,
  type ExecutionPlanNode,
  type SourceDefinition,
} from '@nkzw/fate/server';
import type { AppContext } from './context.ts';

type AnyRecord = Record<string, unknown>;

type PrismaDelegate = {
  groupBy?: (args: Record<string, unknown>) => Promise<Array<AnyRecord>>;
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

const resolveSourceReference = (
  source: SourceDefinition<AnyRecord, unknown> | (() => SourceDefinition<AnyRecord, unknown>),
) => (typeof source === 'function' ? source() : source);

const getConflictingCountRequests = <Context>(
  node: ExecutionPlanNode<Context>,
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

const countChildrenByParentKey = async ({
  ctx,
  foreignKey,
  getDelegate,
  parentKeys,
  source,
  where,
}: {
  ctx: AppContext;
  foreignKey: string;
  getDelegate: (ctx: AppContext, source: SourceDefinition<AnyRecord, unknown>) => PrismaDelegate;
  parentKeys: Array<unknown>;
  source: SourceDefinition<AnyRecord, unknown>;
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

export const attachConflictingComputedCounts = async <Context>({
  ctx,
  getDelegate,
  items,
  node,
  source,
}: {
  ctx: AppContext;
  getDelegate: (ctx: AppContext, source: SourceDefinition<AnyRecord, unknown>) => PrismaDelegate;
  items: Array<AnyRecord>;
  node: ExecutionPlanNode<Context>;
  source: SourceDefinition<AnyRecord, unknown>;
}) => {
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
        getDelegate,
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
      getDelegate,
      items: childItems,
      node: relationNode,
      source: childSource,
    });
  }

  return items;
};
