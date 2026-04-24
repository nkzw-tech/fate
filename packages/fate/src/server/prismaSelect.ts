import type { ViewPlan, ViewPlanNode } from './dataView.ts';
import { getScopedArgs, toPrismaArgs } from './queryArgs.ts';

type AnyRecord = Record<string, unknown>;

const toPrismaOrderBy = (orderBy: Array<{ direction: 'asc' | 'desc'; field: string }>) =>
  orderBy.map((entry) => ({ [entry.field]: entry.direction }));

/**
 * Builds a Prisma `select` object from flattened selection paths and optional
 * scoped args, always including the `id` field.
 */
export function prismaSelect(
  paths: Array<string>,
  args?: Record<string, unknown>,
): Record<string, unknown> {
  const allPaths = [...new Set([...paths, 'id'])];
  const select: Record<string, unknown> = {};

  for (const path of allPaths) {
    const segments = path.split('.');
    let current = select;
    let currentPath = '';

    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}.${segment}` : segment;

      if (index === segments.length - 1) {
        if (segment === 'cursor') {
          return;
        }

        current[segment] = true;
        return;
      }

      const existing = current[segment];
      const relation =
        existing && typeof existing === 'object' && existing !== null && 'select' in existing
          ? (existing as Record<string, unknown> & {
              select: Record<string, unknown>;
            })
          : ({ select: {} } as Record<string, unknown> & {
              select: Record<string, unknown>;
            });

      const scopedArgs = getScopedArgs(args, currentPath);
      if (scopedArgs) {
        Object.assign(relation, toPrismaArgs(scopedArgs));
      }

      current[segment] = relation;
      current = relation.select;
    });
  }

  return select;
}

const mergeObject = (target: AnyRecord, source: AnyRecord) => {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (
      existing &&
      value &&
      typeof existing === 'object' &&
      typeof value === 'object' &&
      !Array.isArray(existing) &&
      !Array.isArray(value)
    ) {
      mergeObject(existing as AnyRecord, value as AnyRecord);
      continue;
    }
    target[key] = value;
  }
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as AnyRecord).sort(([left], [right]) =>
      left.localeCompare(right),
    );

    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

const getConflictingCountRelations = <Context>(node: ViewPlanNode<Context>): Set<string> => {
  const signaturesByRelation = new Map<string, Set<string>>();

  for (const computed of node.computeds.values()) {
    if (!computed.select) {
      continue;
    }

    for (const selection of Object.values(computed.select)) {
      if (selection.kind !== 'count') {
        continue;
      }

      const signatures = signaturesByRelation.get(selection.relation) ?? new Set<string>();
      signatures.add(stableStringify(selection.where ?? null));
      signaturesByRelation.set(selection.relation, signatures);
    }
  }

  return new Set(
    [...signaturesByRelation.entries()]
      .filter(([, signatures]) => signatures.size > 1)
      .map(([relation]) => relation),
  );
};

const ensureRelationSelect = (select: AnyRecord, path: string | null): AnyRecord => {
  if (!path) {
    return select;
  }

  const segments = path.split('.');
  let current = select;

  for (const segment of segments) {
    const existing = current[segment];

    if (existing && typeof existing === 'object' && 'select' in (existing as AnyRecord)) {
      const relation = existing as AnyRecord & { select?: AnyRecord };
      if (
        !relation.select ||
        typeof relation.select !== 'object' ||
        Array.isArray(relation.select)
      ) {
        relation.select = {};
      }
      current = relation.select;
      continue;
    }

    const relation = { select: {} as AnyRecord };
    current[segment] = relation;
    current = relation.select;
  }

  return current;
};

const assignDependencyPath = (select: AnyRecord, path: string) => {
  const segments = path.split('.');
  let current = select;

  for (const [index, segment] of segments.entries()) {
    if (index === segments.length - 1) {
      current[segment] = true;
      continue;
    }

    current = ensureRelationSelect(current, segment);
  }
};

const applyComputedSelections = <Context>(node: ViewPlanNode<Context>, select: AnyRecord) => {
  const conflictingCountRelations = getConflictingCountRelations(node);

  for (const computed of node.computeds.values()) {
    if (!computed.select) {
      continue;
    }

    for (const selection of Object.values(computed.select)) {
      if (selection.kind === 'count') {
        if (conflictingCountRelations.has(selection.relation)) {
          continue;
        }

        const target = ensureRelationSelect(select, node.path);
        const existing = (target._count as AnyRecord | undefined) ?? { select: {} };
        target._count = existing;
        const countSelect = (existing.select as AnyRecord | undefined) ?? {};
        existing.select = countSelect;
        countSelect[selection.relation] = selection.where ? { where: selection.where } : true;
        continue;
      }

      const target = ensureRelationSelect(select, node.path);
      assignDependencyPath(target, selection.path);
    }
  }

  for (const relation of node.relations.values()) {
    applyComputedSelections(relation, select);
  }
};

const collectResolverSelections = <Context>(
  node: ViewPlanNode<Context>,
  select: AnyRecord,
  args?: Record<string, unknown>,
  context?: Context,
) => {
  for (const resolver of node.resolvers.values()) {
    if (!resolver.select) {
      continue;
    }

    const addition =
      typeof resolver.select === 'function' ? resolver.select({ args, context }) : resolver.select;

    if (addition && typeof addition === 'object' && !Array.isArray(addition)) {
      const target = ensureRelationSelect(select, node.path);
      mergeObject(target, addition as AnyRecord);
    }
  }

  for (const relation of node.relations.values()) {
    collectResolverSelections(relation, select, args, context);
  }
};

const buildNodeSelect = <Context>(node: ViewPlanNode<Context>): AnyRecord => {
  const select: AnyRecord = {};

  for (const field of node.selectedFields) {
    if (field === 'cursor') {
      continue;
    }
    select[field] = true;
  }

  for (const [field, relation] of node.relations) {
    const relationSelect = buildNodeSelect(relation);
    const scopedArgs = relation.args;
    const relationConfig =
      'source' in node
        ? (
            node as AnyRecord & {
              source?: {
                relations?: Record<string, { kind?: 'many' | 'manyToMany' | 'one' }>;
              };
            }
          ).source?.relations?.[field]
        : undefined;
    const isCollectionRelation = relationConfig
      ? relationConfig.kind === 'many' || relationConfig.kind === 'manyToMany'
      : false;
    const orderBy =
      isCollectionRelation && 'orderBy' in relation
        ? toPrismaOrderBy(
            ((
              relation as AnyRecord & {
                orderBy?: Array<{ direction: 'asc' | 'desc'; field: string }>;
              }
            ).orderBy ?? []) as Array<{ direction: 'asc' | 'desc'; field: string }>,
          )
        : [];
    const next =
      scopedArgs && Object.keys(scopedArgs).length
        ? {
            ...toPrismaArgs(scopedArgs),
            ...(orderBy.length ? { orderBy } : null),
            select: relationSelect,
          }
        : {
            ...(orderBy.length ? { orderBy } : null),
            select: relationSelect,
          };
    select[field] = next;
  }

  return select;
};

export function toPrismaSelect<Item extends AnyRecord, Context = unknown>(
  plan: ViewPlan<Item, Context>,
): AnyRecord {
  const select = buildNodeSelect(plan.root);
  applyComputedSelections(plan.root, select);
  collectResolverSelections(plan.root, select, plan.args, plan.ctx);
  return select;
}
