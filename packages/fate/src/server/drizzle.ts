/**
 * The fate Drizzle source adapter.
 *
 * @example
 * import { createDrizzleSourceRuntime } from '@nkzw/fate/server/drizzle';
 *
 * @module @nkzw/fate/server/drizzle
 */

import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isTable,
  lt,
  or,
  sql,
} from 'drizzle-orm';
import type { AnyColumn, SQLWrapper, Table } from 'drizzle-orm';
import type { AnyRecord } from '../types.ts';
import type { ConnectionResult } from './connection.ts';
import { attachComputedState, type ComputedNeed } from './dataView.ts';
import { createSourceRegistry, type SourceRegistry } from './executor.ts';
import type {
  ExecutionPlan,
  ExecutionPlanNode,
  SourceDefinition,
  SourceRelation,
} from './source.ts';

type Source = SourceDefinition<AnyRecord, unknown>;
type Relation = SourceRelation<AnyRecord, unknown>;
type ColumnMap = Record<string, AnyColumn>;
type DrizzleTable = Table;

type DrizzleDatabase = {
  select: (fields?: Record<string, unknown>) => any;
};

type DrizzleDatabaseInput<Context> = DrizzleDatabase | ((ctx: Context) => DrizzleDatabase);

export type DrizzleQueryExtra = {
  extraFields?: Array<string>;
  where?: SQLWrapper;
};

type DrizzleManyToManyColumns =
  | {
      foreignColumn: AnyColumn;
      localColumn: AnyColumn;
    }
  | {
      foreignColumn?: never;
      localColumn?: never;
    };

export type DrizzleManyToManyConfig = DrizzleManyToManyColumns & {
  columns?: ColumnMap;
  table: DrizzleTable;
};

export type DrizzleManyToManyInput = DrizzleManyToManyConfig | DrizzleTable;

export type DrizzleSourceConfig<
  Item extends AnyRecord = AnyRecord,
  TTable extends DrizzleTable = DrizzleTable,
> = {
  columns?: ColumnMap;
  manyToMany?: Record<string, DrizzleManyToManyInput>;
  source: SourceDefinition<Item, unknown>;
  table: TTable;
};

export type DrizzleSourceRuntime<Context> = {
  fetchById: <Item extends AnyRecord = AnyRecord>({
    ctx,
    extra,
    id,
    plan,
  }: {
    ctx?: Context;
    extra?: DrizzleQueryExtra;
    id: string;
    plan: ExecutionPlan<Item, Context>;
  }) => Promise<Item | null>;
  fetchByIds: <Item extends AnyRecord = AnyRecord>({
    ctx,
    extra,
    ids,
    plan,
  }: {
    ctx?: Context;
    extra?: DrizzleQueryExtra;
    ids: Array<string>;
    plan: ExecutionPlan<Item, Context>;
  }) => Promise<Array<Item>>;
  fetchConnection: <Item extends AnyRecord = AnyRecord>({
    ctx,
    cursor,
    direction,
    extra,
    plan,
    take,
  }: {
    ctx?: Context;
    cursor?: string;
    direction: 'backward' | 'forward';
    extra?: DrizzleQueryExtra;
    plan: ExecutionPlan<Item, Context>;
    take: number;
  }) => Promise<Array<Item>>;
  registry: SourceRegistry<Context>;
};

type RegisteredSourceConfig = DrizzleSourceConfig<AnyRecord> & {
  columns: ColumnMap;
};

type RegisteredManyToManyConfig = {
  foreignColumn: AnyColumn;
  localColumn: AnyColumn;
  table: DrizzleTable;
};

type PaginationArgs = {
  after?: string;
  before?: string;
  first?: number;
  last?: number;
};

const resolveSource = (source: Source | (() => Source)): Source =>
  typeof source === 'function' ? source() : source;

const getColumn = (columns: ColumnMap, field: string) => {
  const column = columns[field];
  if (!column) {
    throw new Error(`No Drizzle column registered for field ${field}.`);
  }
  return column;
};

const paginationArgs = (args?: Record<string, unknown>): PaginationArgs => ({
  after: typeof args?.after === 'string' ? args.after : undefined,
  before: typeof args?.before === 'string' ? args.before : undefined,
  first: typeof args?.first === 'number' ? args.first : undefined,
  last: typeof args?.last === 'number' ? args.last : undefined,
});

const hasPagination = (args?: Record<string, unknown>) => {
  const value = paginationArgs(args);
  return (
    value.after !== undefined ||
    value.before !== undefined ||
    value.first !== undefined ||
    value.last !== undefined
  );
};

const getConnectionDirection = (args?: Record<string, unknown>) =>
  args?.before !== undefined || typeof args?.last === 'number' ? 'backward' : 'forward';

const getConnectionSize = (fallback: number, args?: Record<string, unknown>) =>
  (typeof args?.first === 'number' ? args.first : undefined) ??
  (typeof args?.last === 'number' ? args.last : undefined) ??
  fallback;

const buildConnection = <TNode extends { id: string }>({
  cursor,
  direction,
  items,
  pageSize,
}: {
  cursor?: string;
  direction: 'backward' | 'forward';
  items: Array<TNode>;
  pageSize: number;
}): ConnectionResult<TNode> => {
  const hasMore = items.length > pageSize;
  const limitedItems = direction === 'forward' ? items.slice(0, pageSize) : items.slice(-pageSize);
  const connectionItems = limitedItems.map((node) => ({
    cursor: node.id,
    node,
  }));
  const firstItem = connectionItems[0];
  const lastItem = connectionItems.at(-1);

  return {
    items: connectionItems,
    pagination: {
      hasNext: direction === 'backward' ? Boolean(cursor) : hasMore,
      hasPrevious: direction === 'backward' ? hasMore : Boolean(cursor),
      nextCursor: lastItem?.cursor,
      previousCursor: (direction === 'backward' ? hasMore : Boolean(cursor))
        ? firstItem?.cursor
        : undefined,
    },
  };
};

const mapByField = <T extends AnyRecord>(items: Array<T>, field: string) =>
  new Map(items.map((item) => [item[field], item]));

const compactKeys = (values: Array<unknown>) => [
  ...new Set(values.filter((value) => value !== null && value !== undefined)),
];

const reorderByIds = <T extends { id: string }>(ids: Array<string>, items: Array<T>) => {
  const itemsById = mapByField(items, 'id');
  return ids.flatMap((id) => {
    const item = itemsById.get(id);
    return item ? [item as T] : [];
  });
};

const addColumnField = (fields: Set<string>, field: string) => {
  if (!field || field === 'cursor') {
    return;
  }
  fields.add(field);
};

const addNeedColumns = (fields: Set<string>, needs?: Record<string, ComputedNeed>) => {
  if (!needs) {
    return;
  }

  for (const need of Object.values(needs)) {
    if (need.kind === 'field') {
      const [field] = need.path.split('.');
      addColumnField(fields, field);
    }
  }
};

const getRequiredFields = (node: ExecutionPlanNode<any, any>, extraFields: Array<string> = []) => {
  const fields = new Set<string>(extraFields);
  addColumnField(fields, node.source.id);

  for (const field of node.selectedFields) {
    addColumnField(fields, field);
  }

  for (const order of node.orderBy) {
    addColumnField(fields, order.field);
  }

  for (const computed of node.computeds.values()) {
    addNeedColumns(fields, computed.needs);
  }

  for (const [field] of node.relations) {
    const sourceRelation = node.source.relations?.[field];
    if (sourceRelation) {
      addColumnField(fields, sourceRelation.localKey);
    }
  }

  return fields;
};

const compareColumn = (
  direction: 'backward' | 'forward',
  naturalDirection: 'asc' | 'desc',
  column: any,
  value: unknown,
) => {
  const forward = naturalDirection === 'asc' ? gt(column, value) : lt(column, value);
  const backward = naturalDirection === 'asc' ? lt(column, value) : gt(column, value);
  return direction === 'forward' ? forward : backward;
};

const buildCursorWhere = ({
  columns,
  cursorValues,
  direction,
  node,
}: {
  columns: ColumnMap;
  cursorValues: Record<string, unknown>;
  direction: 'backward' | 'forward';
  node: ExecutionPlanNode<any, any>;
}) => {
  const branches = node.orderBy.map((entry, index) => {
    const column = getColumn(columns, entry.field);
    const compare = compareColumn(direction, entry.direction, column, cursorValues[entry.field]);
    const equalities = node.orderBy
      .slice(0, index)
      .map((previous) => eq(getColumn(columns, previous.field), cursorValues[previous.field]));

    return equalities.length ? and(...equalities, compare) : compare;
  });

  return branches.length === 1 ? branches[0] : or(...branches);
};

const getQueryOrder = (
  direction: 'backward' | 'forward',
  node: ExecutionPlanNode<any, any>,
  columns: ColumnMap,
) =>
  node.orderBy.map((entry) => {
    const column = getColumn(columns, entry.field);
    return direction === 'forward'
      ? entry.direction === 'asc'
        ? asc(column)
        : desc(column)
      : entry.direction === 'asc'
        ? desc(column)
        : asc(column);
  });

const whereFromObject = (columns: ColumnMap, where?: AnyRecord) => {
  if (!where || Object.keys(where).length === 0) {
    return undefined;
  }

  const conditions = Object.entries(where).map(([field, value]) =>
    eq(getColumn(columns, field), value),
  );
  return conditions.length === 1 ? conditions[0] : and(...conditions);
};

const toRegisteredConfig = (config: DrizzleSourceConfig<AnyRecord>): RegisteredSourceConfig => ({
  ...config,
  columns: config.columns ?? getTableColumns(config.table),
});

const resolveManyToManyConfig = ({
  field,
  source,
  sourceRelation,
  through: throughInput,
}: {
  field: string;
  source: Source;
  sourceRelation: Relation;
  through: DrizzleManyToManyInput;
}): RegisteredManyToManyConfig => {
  const through = isTable(throughInput) ? { table: throughInput } : throughInput;

  if (through.localColumn && through.foreignColumn) {
    return {
      foreignColumn: through.foreignColumn,
      localColumn: through.localColumn,
      table: through.table,
    };
  }

  if (!sourceRelation.through) {
    throw new Error(
      `Drizzle many-to-many relation ${source.view.typeName}.${field} requires source relation 'through' keys or explicit join columns.`,
    );
  }

  const throughColumns = through.columns ?? getTableColumns(through.table);

  return {
    foreignColumn: getColumn(throughColumns, sourceRelation.through.foreignKey),
    localColumn: getColumn(throughColumns, sourceRelation.through.localKey),
    table: through.table,
  };
};

export function createDrizzleSourceRuntime<Context>({
  db,
  sources,
}: {
  db: DrizzleDatabaseInput<Context>;
  sources: Array<DrizzleSourceConfig<AnyRecord>>;
}): DrizzleSourceRuntime<Context> {
  const sourceConfigs = new Map<Source, RegisteredSourceConfig>(
    sources.map((source) => [source.source as Source, toRegisteredConfig(source)]),
  );

  const getSourceConfig = (source: Source): RegisteredSourceConfig => {
    const config = sourceConfigs.get(source);
    if (!config) {
      throw new Error(`No Drizzle table registered for source ${source.view.typeName}.`);
    }
    return config;
  };

  const getDb = (ctx?: Context) => {
    if (typeof db === 'function') {
      return db(ctx as Context);
    }

    return db;
  };

  const buildSelection = (node: ExecutionPlanNode<any, any>, extraFields: Array<string> = []) => {
    const config = getSourceConfig(node.source);
    const selection: Record<string, any> = {};

    for (const field of getRequiredFields(node, extraFields)) {
      selection[field] = getColumn(config.columns, field);
    }

    return selection;
  };

  const queryRows = async ({
    ctx,
    extraFields,
    node,
    where,
  }: {
    ctx?: Context;
    extraFields?: Array<string>;
    node: ExecutionPlanNode<any, any>;
    where?: any;
  }) => {
    const config = getSourceConfig(node.source);
    return (await getDb(ctx)
      .select(buildSelection(node, extraFields))
      .from(config.table)
      .where(where)
      .orderBy(...getQueryOrder('forward', node, config.columns))) as Array<AnyRecord>;
  };

  const queryNodePage = async ({
    baseWhere,
    ctx,
    cursor,
    direction,
    node,
    take,
  }: {
    baseWhere?: any;
    ctx?: Context;
    cursor?: string;
    direction: 'backward' | 'forward';
    node: ExecutionPlanNode<any, any>;
    take: number;
  }) => {
    const config = getSourceConfig(node.source);
    const currentDb = getDb(ctx);
    let whereClause = baseWhere;

    if (cursor) {
      const cursorSelection = Object.fromEntries(
        node.orderBy.map((entry) => [entry.field, getColumn(config.columns, entry.field)]),
      );
      const [cursorRow] = await currentDb
        .select(cursorSelection)
        .from(config.table)
        .where(
          baseWhere
            ? and(baseWhere, eq(getColumn(config.columns, node.source.id), cursor))
            : eq(getColumn(config.columns, node.source.id), cursor),
        )
        .limit(1);

      if (cursorRow) {
        const cursorWhere = buildCursorWhere({
          columns: config.columns,
          cursorValues: cursorRow,
          direction,
          node,
        });
        whereClause = whereClause ? and(whereClause, cursorWhere) : cursorWhere;
      }
    }

    const rows = (await currentDb
      .select(buildSelection(node))
      .from(config.table)
      .where(whereClause)
      .orderBy(...getQueryOrder(direction, node, config.columns))
      .limit(take)) as Array<AnyRecord>;
    return direction === 'backward' ? rows.reverse() : rows;
  };

  const attachComputedCounts = async (
    items: Array<AnyRecord>,
    node: ExecutionPlanNode<any, any>,
    ctx?: Context,
  ) => {
    if (items.length === 0) {
      return;
    }

    for (const [field, computed] of node.computeds) {
      if (!computed.needs) {
        continue;
      }

      for (const [needName, need] of Object.entries(computed.needs)) {
        if (need.kind !== 'count') {
          continue;
        }

        const sourceRelation = node.source.relations?.[need.relation];
        if (!sourceRelation || sourceRelation.kind !== 'many') {
          throw new Error(
            `Computed count ${node.source.view.typeName}.${field} requires a 'many' relation named ${need.relation}.`,
          );
        }

        const childSource = resolveSource(sourceRelation.source);
        const childConfig = getSourceConfig(childSource);
        const parentKeys = compactKeys(items.map((item) => item[sourceRelation.localKey]));
        if (parentKeys.length === 0) {
          continue;
        }
        const where = and(
          inArray(getColumn(childConfig.columns, sourceRelation.foreignKey), parentKeys),
          whereFromObject(childConfig.columns, need.where),
        );
        const rows = await getDb(ctx)
          .select({
            count: sql<number>`count(*)`.mapWith(Number),
            parentKey: getColumn(childConfig.columns, sourceRelation.foreignKey),
          })
          .from(childConfig.table)
          .where(where)
          .groupBy(getColumn(childConfig.columns, sourceRelation.foreignKey));
        const counts = new Map(rows.map((row: AnyRecord) => [row.parentKey, row.count]));

        for (const item of items) {
          attachComputedState(item, field, {
            [needName]: counts.get(item[sourceRelation.localKey]) ?? 0,
          });
        }
      }
    }
  };

  const fetchManyRelation = async ({
    ctx,
    items,
    relationNode,
    sourceRelation,
  }: {
    ctx?: Context;
    items: Array<AnyRecord>;
    relationNode: ExecutionPlanNode<any, any>;
    sourceRelation: Relation;
  }) => {
    const childSource = resolveSource(sourceRelation.source);
    const childConfig = getSourceConfig(childSource);
    const parentKeys = compactKeys(items.map((item) => item[sourceRelation.localKey]));

    if (parentKeys.length === 0) {
      return new Map<unknown, Array<AnyRecord>>();
    }

    const rows = await queryRows({
      ctx,
      extraFields: [sourceRelation.foreignKey],
      node: relationNode,
      where: inArray(getColumn(childConfig.columns, sourceRelation.foreignKey), parentKeys),
    });
    const hydrated = await hydrateRows(rows, relationNode, ctx);
    const byParentKey = new Map<unknown, Array<AnyRecord>>();

    for (const item of hydrated) {
      const key = item[sourceRelation.foreignKey];
      const entries = byParentKey.get(key) ?? [];
      entries.push(item);
      byParentKey.set(key, entries);
    }

    return byParentKey;
  };

  const fetchManyConnection = async (
    parentKey: unknown,
    relationNode: ExecutionPlanNode<any, any>,
    sourceRelation: Relation,
    ctx?: Context,
  ): Promise<ConnectionResult<AnyRecord>> => {
    const childConfig = getSourceConfig(resolveSource(sourceRelation.source));
    const args = paginationArgs(relationNode.args);
    const direction = getConnectionDirection(args);
    const pageSize = getConnectionSize(20, args);
    const cursor = direction === 'forward' ? args.after : args.before;

    if (parentKey === null || parentKey === undefined) {
      return buildConnection({
        cursor,
        direction,
        items: [],
        pageSize,
      });
    }

    const rows = await queryNodePage({
      baseWhere: eq(getColumn(childConfig.columns, sourceRelation.foreignKey), parentKey),
      ctx,
      cursor,
      direction,
      node: relationNode,
      take: pageSize + 1,
    });
    const hydrated = await hydrateRows(rows, relationNode, ctx);
    return buildConnection({
      cursor,
      direction,
      items: hydrated as Array<AnyRecord & { id: string }>,
      pageSize,
    });
  };

  const queryManyToManyPage = async ({
    ctx,
    cursor,
    direction,
    node,
    parentKey,
    sourceRelation,
    take,
    through,
  }: {
    ctx?: Context;
    cursor?: string;
    direction: 'backward' | 'forward';
    node: ExecutionPlanNode<any, any>;
    parentKey: unknown;
    sourceRelation: Relation;
    take: number;
    through: RegisteredManyToManyConfig;
  }) => {
    const childConfig = getSourceConfig(resolveSource(sourceRelation.source));
    const currentDb = getDb(ctx);
    let whereClause: any = eq(through.localColumn, parentKey);

    if (cursor) {
      const cursorSelection = Object.fromEntries(
        node.orderBy.map((entry) => [entry.field, getColumn(childConfig.columns, entry.field)]),
      );
      const [cursorRow] = await currentDb
        .select(cursorSelection)
        .from(through.table)
        .innerJoin(
          childConfig.table,
          eq(through.foreignColumn, getColumn(childConfig.columns, sourceRelation.foreignKey)),
        )
        .where(
          and(
            eq(through.localColumn, parentKey),
            eq(getColumn(childConfig.columns, node.source.id), cursor),
          ),
        )
        .limit(1);

      if (cursorRow) {
        whereClause = and(
          whereClause,
          buildCursorWhere({
            columns: childConfig.columns,
            cursorValues: cursorRow,
            direction,
            node,
          }),
        );
      }
    }

    const rows = (await currentDb
      .select({
        ...buildSelection(node),
        parentKey: through.localColumn,
      })
      .from(through.table)
      .innerJoin(
        childConfig.table,
        eq(through.foreignColumn, getColumn(childConfig.columns, sourceRelation.foreignKey)),
      )
      .where(whereClause)
      .orderBy(...getQueryOrder(direction, node, childConfig.columns))
      .limit(take)) as Array<AnyRecord & { parentKey: unknown }>;

    return direction === 'backward' ? rows.reverse() : rows;
  };

  const fetchManyToManyConnection = async (
    parentKey: unknown,
    relationNode: ExecutionPlanNode<any, any>,
    sourceRelation: Relation,
    through: RegisteredManyToManyConfig,
    ctx?: Context,
  ): Promise<ConnectionResult<AnyRecord>> => {
    const args = paginationArgs(relationNode.args);
    const direction = getConnectionDirection(args);
    const pageSize = getConnectionSize(20, args);
    const cursor = direction === 'forward' ? args.after : args.before;

    if (parentKey === null || parentKey === undefined) {
      return buildConnection({
        cursor,
        direction,
        items: [],
        pageSize,
      });
    }

    const rows = await queryManyToManyPage({
      ctx,
      cursor,
      direction,
      node: relationNode,
      parentKey,
      sourceRelation,
      take: pageSize + 1,
      through,
    });
    const hydrated = await hydrateRows(rows, relationNode, ctx);
    return buildConnection({
      cursor,
      direction,
      items: hydrated as Array<AnyRecord & { id: string }>,
      pageSize,
    });
  };

  const fetchManyToManyRelation = async ({
    ctx,
    items,
    node,
    relationField,
    relationNode,
    sourceRelation,
  }: {
    ctx?: Context;
    items: Array<AnyRecord>;
    node: ExecutionPlanNode<any, any>;
    relationField: string;
    relationNode: ExecutionPlanNode<any, any>;
    sourceRelation: Relation;
  }) => {
    const parentConfig = getSourceConfig(node.source);
    const childConfig = getSourceConfig(resolveSource(sourceRelation.source));
    const throughConfig = parentConfig.manyToMany?.[relationField];

    if (!throughConfig) {
      throw new Error(
        `No Drizzle many-to-many table registered for ${node.source.view.typeName}.${relationField}.`,
      );
    }
    const through = resolveManyToManyConfig({
      field: relationField,
      source: node.source,
      sourceRelation,
      through: throughConfig,
    });

    const parentKeys = compactKeys(items.map((item) => item[sourceRelation.localKey]));
    if (parentKeys.length === 0) {
      return new Map<unknown, Array<AnyRecord>>();
    }

    const rows = (await getDb(ctx)
      .select({
        ...buildSelection(relationNode),
        parentKey: through.localColumn,
      })
      .from(through.table)
      .innerJoin(
        childConfig.table,
        eq(through.foreignColumn, getColumn(childConfig.columns, sourceRelation.foreignKey)),
      )
      .where(inArray(through.localColumn, parentKeys))
      .orderBy(...getQueryOrder('forward', relationNode, childConfig.columns))) as Array<
      AnyRecord & { parentKey: unknown }
    >;
    const hydrated = await hydrateRows(rows, relationNode, ctx);
    const byParentKey = new Map<unknown, Array<AnyRecord>>();

    for (const item of hydrated) {
      const entries = byParentKey.get(item.parentKey) ?? [];
      entries.push(item);
      byParentKey.set(item.parentKey, entries);
    }

    return byParentKey;
  };

  const hydrateRows = async (
    rows: Array<AnyRecord>,
    node: ExecutionPlanNode<any, any>,
    ctx?: Context,
  ): Promise<Array<AnyRecord>> => {
    const items = rows.map((row) => ({ ...row }));

    await attachComputedCounts(items, node, ctx);

    for (const [field, relationNode] of node.relations) {
      const sourceRelation = node.source.relations?.[field];
      if (!sourceRelation) {
        continue;
      }

      if (sourceRelation.kind === 'one') {
        const childConfig = getSourceConfig(resolveSource(sourceRelation.source));
        const childKeys = compactKeys(items.map((item) => item[sourceRelation.localKey]));
        const childRows = childKeys.length
          ? await queryRows({
              ctx,
              node: relationNode,
              where: inArray(getColumn(childConfig.columns, sourceRelation.foreignKey), childKeys),
            })
          : [];
        const children = await hydrateRows(childRows, relationNode, ctx);
        const childByKey = mapByField(children, sourceRelation.foreignKey);

        for (const item of items) {
          const localKey = item[sourceRelation.localKey];
          item[field] =
            localKey !== null && localKey !== undefined
              ? ((childByKey.get(localKey) as AnyRecord | undefined) ?? null)
              : null;
        }
        continue;
      }

      if (sourceRelation.kind === 'manyToMany') {
        const parentConfig = getSourceConfig(node.source);
        const throughConfig = parentConfig.manyToMany?.[field];

        if (!throughConfig) {
          throw new Error(
            `No Drizzle many-to-many table registered for ${node.source.view.typeName}.${field}.`,
          );
        }

        const through = resolveManyToManyConfig({
          field,
          source: node.source,
          sourceRelation,
          through: throughConfig,
        });

        if (hasPagination(relationNode.args)) {
          const connections = await Promise.all(
            items.map(
              async (item) =>
                [
                  item[sourceRelation.localKey],
                  await fetchManyToManyConnection(
                    item[sourceRelation.localKey],
                    relationNode,
                    sourceRelation,
                    through,
                    ctx,
                  ),
                ] as const,
            ),
          );
          const connectionByParentKey = new Map(connections);

          for (const item of items) {
            item[field] = connectionByParentKey.get(item[sourceRelation.localKey]);
          }
          continue;
        }

        const byParentKey = await fetchManyToManyRelation({
          ctx,
          items,
          node,
          relationField: field,
          relationNode,
          sourceRelation,
        });

        for (const item of items) {
          item[field] = byParentKey.get(item[sourceRelation.localKey]) ?? [];
        }
        continue;
      }

      if (hasPagination(relationNode.args)) {
        const connections = await Promise.all(
          items.map(
            async (item) =>
              [
                item[sourceRelation.localKey],
                await fetchManyConnection(
                  item[sourceRelation.localKey],
                  relationNode,
                  sourceRelation,
                  ctx,
                ),
              ] as const,
          ),
        );
        const connectionByParentKey = new Map(connections);

        for (const item of items) {
          item[field] = connectionByParentKey.get(item[sourceRelation.localKey]);
        }
        continue;
      }

      const byParentKey = await fetchManyRelation({
        ctx,
        items,
        relationNode,
        sourceRelation,
      });

      for (const item of items) {
        item[field] = byParentKey.get(item[sourceRelation.localKey]) ?? [];
      }
    }

    return items;
  };

  const fetchByIds = async <Item extends AnyRecord>({
    ctx,
    extra,
    ids,
    plan,
  }: {
    ctx?: Context;
    extra?: DrizzleQueryExtra;
    ids: Array<string>;
    plan: ExecutionPlan<Item, Context>;
  }) => {
    if (!ids.length) {
      return [];
    }

    const config = getSourceConfig(plan.source as Source);
    const rows = await queryRows({
      ctx,
      extraFields: extra?.extraFields,
      node: plan.root,
      where: inArray(getColumn(config.columns, plan.source.id), [...new Set(ids)]),
    });
    return reorderByIds(
      ids,
      (await hydrateRows(rows, plan.root, ctx)) as Array<AnyRecord & { id: string }>,
    ) as Array<Item>;
  };

  const fetchById = async <Item extends AnyRecord>({
    ctx,
    extra,
    id,
    plan,
  }: {
    ctx?: Context;
    extra?: DrizzleQueryExtra;
    id: string;
    plan: ExecutionPlan<Item, Context>;
  }) => (await fetchByIds({ ctx, extra, ids: [id], plan }))[0] ?? null;

  const fetchConnection = async <Item extends AnyRecord>({
    ctx,
    cursor,
    direction,
    extra,
    plan,
    take,
  }: {
    ctx?: Context;
    cursor?: string;
    direction: 'backward' | 'forward';
    extra?: DrizzleQueryExtra;
    plan: ExecutionPlan<Item, Context>;
    take: number;
  }) =>
    hydrateRows(
      await queryNodePage({
        baseWhere: extra?.where,
        ctx,
        cursor,
        direction,
        node: plan.root,
        take,
      }),
      plan.root,
      ctx,
    ) as Promise<Array<Item>>;

  const registry = createSourceRegistry<Context>(
    sources.map((source) => [
      source.source as Source,
      {
        byId: ({ ctx, extra, id, plan }) =>
          fetchById({ ctx, extra: extra as DrizzleQueryExtra | undefined, id, plan }),
        byIds: ({ ctx, extra, ids, plan }) =>
          fetchByIds({ ctx, extra: extra as DrizzleQueryExtra | undefined, ids, plan }),
        connection: ({ ctx, cursor, direction, extra, plan, take }) =>
          fetchConnection({
            ctx,
            cursor,
            direction,
            extra: extra as DrizzleQueryExtra | undefined,
            plan,
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

export const createDrizzleSourceRegistry = <Context>(
  options: Parameters<typeof createDrizzleSourceRuntime<Context>>[0],
) => createDrizzleSourceRuntime<Context>(options).registry;
