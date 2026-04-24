/**
 * Fate's Drizzle integration.
 *
 * @example
 * import { createDrizzleFate } from '@nkzw/fate/server/drizzle';
 *
 * @module @nkzw/fate/server/drizzle
 */

import {
  and,
  asc,
  desc,
  eq,
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  getTableColumns,
  gt,
  inArray,
  isTable,
  lt,
  normalizeRelation,
  or,
  sql,
} from 'drizzle-orm';
import type { AnyColumn, SQLWrapper, Table, TableRelationalConfig } from 'drizzle-orm';
import { isRecord } from '../record.ts';
import type { AnyRecord } from '../types.ts';
import { withConnection } from './connection.ts';
import type { ConnectionResult } from './connection.ts';
import {
  attachComputedState,
  isDataView,
  type ComputedSelection,
  type DataView,
} from './dataView.ts';
import {
  createSourceRegistry,
  resolveSourceById,
  resolveSourceByIds,
  resolveSourceConnection,
  type SourceRegistry,
} from './executor.ts';
import {
  collectDataViewConfigs,
  createSourcePlan,
  createSourceDefinitions,
  getDataViewSourceConfig,
  type DataViewModule,
  type SourceConfig,
  type SourcePlan,
  type SourcePlanNode,
  type SourceDefinition,
  type SourceRelation,
} from './source.ts';
import { bindSourceProcedures } from './sourceRouter.ts';

type Source = SourceDefinition<AnyRecord, unknown>;
type Relation = SourceRelation<AnyRecord, unknown>;
type SourceTarget<Item extends AnyRecord = AnyRecord> =
  | DataView<Item>
  | SourceDefinition<Item, unknown>;
type ViewTarget<Item extends AnyRecord = AnyRecord> = DataView<Item>;
type ListConfig = {
  defaultSize?: number;
};
type LiveConfig =
  | import('./live.ts').LiveEventBus
  | {
      bus: import('./live.ts').LiveEventBus;
    };
type ViewProcedureInput<
  Item extends AnyRecord,
  ById extends boolean | undefined,
  List extends boolean | ListConfig | undefined,
  Live extends false | LiveConfig | undefined,
> =
  | ViewTarget<Item>
  | {
      byId?: ById;
      list?: List;
      live?: Live;
      view: ViewTarget<Item>;
    };
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

export type DrizzleViewConfig<
  Item extends AnyRecord = AnyRecord,
  TTable extends DrizzleTable = DrizzleTable,
> = SourceConfig<Item, unknown> & {
  columns?: ColumnMap;
  manyToMany?: Record<string, DrizzleManyToManyInput>;
  table: TTable;
};

type DrizzleViewsInput = Array<DataView<AnyRecord> | DrizzleViewConfig<AnyRecord>> | DataViewModule;

type DrizzleSourceAdapterOptions<Context> = {
  db: DrizzleDatabaseInput<Context>;
  schema?: Record<string, unknown>;
  views: DrizzleViewsInput;
};

type DrizzleSchemaMetadata = {
  fullSchema: Record<string, unknown>;
  schema: Record<string, TableRelationalConfig>;
  tableNamesMap: Record<string, string>;
};

export type DrizzleSourceAdapter<Context> = {
  fetchById: <Item extends AnyRecord = AnyRecord>({
    ctx,
    extra,
    id,
    plan,
  }: {
    ctx?: Context;
    extra?: DrizzleQueryExtra;
    id: string;
    plan: SourcePlan<Item, Context>;
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
    plan: SourcePlan<Item, Context>;
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
    plan: SourcePlan<Item, Context>;
    take: number;
  }) => Promise<Array<Item>>;
  getSource: <Item extends AnyRecord = AnyRecord>(
    target: SourceTarget<Item>,
  ) => SourceDefinition<Item, unknown>;
  registry: SourceRegistry<Context>;
};

type ProcedureLike = {
  input: (schema: any) => {
    query: (resolver: (options: any) => unknown) => any;
    subscription: (resolver: (options: any) => unknown) => any;
  };
};

type SourceInput = {
  args?: Record<string, unknown>;
  select: Iterable<string>;
};

type RegisteredSourceConfig = DrizzleViewConfig<AnyRecord> & {
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

const isSourceDefinition = <Item extends AnyRecord>(
  target: SourceTarget<Item>,
): target is SourceDefinition<Item, unknown> => 'view' in target && 'id' in target;

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

const addComputedSelectionColumns = (
  fields: Set<string>,
  select?: Record<string, ComputedSelection>,
) => {
  if (!select) {
    return;
  }

  for (const selection of Object.values(select)) {
    if (selection.kind === 'field') {
      const [field] = selection.path.split('.');
      addColumnField(fields, field);
    }
  }
};

const getRequiredFields = (node: SourcePlanNode<any, any>, extraFields: Array<string> = []) => {
  const fields = new Set<string>(extraFields);
  addColumnField(fields, node.source.id);

  for (const field of node.selectedFields) {
    addColumnField(fields, field);
  }

  for (const order of node.orderBy) {
    addColumnField(fields, order.field);
  }

  for (const computed of node.computeds.values()) {
    addComputedSelectionColumns(fields, computed.select);
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
  node: SourcePlanNode<any, any>;
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
  node: SourcePlanNode<any, any>,
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

const isSQLWrapper = (value: unknown): value is SQLWrapper =>
  isRecord(value) && typeof value.getSQL === 'function';

const whereFromCountSelection = (columns: ColumnMap, where?: unknown) => {
  if (!where) {
    return undefined;
  }

  if (typeof where === 'function') {
    return (where as (columns: ColumnMap) => SQLWrapper | undefined)(columns);
  }

  if (isSQLWrapper(where)) {
    return where;
  }

  if (Object.keys(where).length === 0) {
    return undefined;
  }

  const conditions = Object.entries(where as AnyRecord).map(([field, value]) =>
    eq(getColumn(columns, field), value),
  );
  return conditions.length === 1 ? conditions[0] : and(...conditions);
};

const toRegisteredConfig = (config: DrizzleViewConfig<AnyRecord>): RegisteredSourceConfig => ({
  ...config,
  columns: config.columns ?? getTableColumns(config.table),
});

const lowerFirst = (value: string) => `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;

const getColumnKey = (columns: ColumnMap, column: AnyColumn): string => {
  const entry = Object.entries(columns).find(([, candidate]) => candidate === column);

  if (!entry) {
    throw new Error(`Unable to resolve Drizzle column ${column.name}.`);
  }

  return entry[0];
};

const includesColumn = (columns: ColumnMap, column: AnyColumn) =>
  Object.values(columns).includes(column);

const getDrizzleSchemaMetadata = <Context>({
  db,
  schema,
}: {
  db: DrizzleDatabaseInput<Context>;
  schema?: Record<string, unknown>;
}): DrizzleSchemaMetadata | undefined => {
  if (schema) {
    const extracted = extractTablesRelationalConfig(schema, createTableRelationsHelpers);
    return {
      fullSchema: schema,
      schema: extracted.tables,
      tableNamesMap: extracted.tableNamesMap,
    };
  }

  if (typeof db === 'function') {
    return undefined;
  }

  const metadata = (db as DrizzleDatabase & { _?: Partial<DrizzleSchemaMetadata> })._;
  return metadata?.schema && metadata.fullSchema && metadata.tableNamesMap
    ? {
        fullSchema: metadata.fullSchema,
        schema: metadata.schema,
        tableNamesMap: metadata.tableNamesMap,
      }
    : undefined;
};

const getTableConfig = ({
  config,
  metadata,
}: {
  config: DrizzleViewConfig<AnyRecord>;
  metadata: DrizzleSchemaMetadata;
}): TableRelationalConfig => {
  const entry = Object.entries(metadata.fullSchema).find(([, table]) => table === config.table);

  if (!entry) {
    throw new Error(`No Drizzle schema metadata found for ${config.view.typeName}.`);
  }

  const tableConfig = metadata.schema[entry[0]];
  if (!tableConfig) {
    throw new Error(`No Drizzle relational config found for ${config.view.typeName}.`);
  }

  return tableConfig;
};

const getTableForView = (
  view: DataView<AnyRecord>,
  metadata: DrizzleSchemaMetadata,
): DrizzleTable => {
  const directTable = metadata.fullSchema[lowerFirst(view.typeName)];
  if (isTable(directTable)) {
    return directTable;
  }

  const tableConfig = Object.values(metadata.schema).find(
    (config) =>
      config.tsName === lowerFirst(view.typeName) ||
      config.dbName === view.typeName ||
      lowerFirst(config.dbName) === lowerFirst(view.typeName),
  );

  if (tableConfig) {
    const table = metadata.fullSchema[tableConfig.tsName];
    if (isTable(table)) {
      return table;
    }
  }

  throw new Error(`No Drizzle table found for view ${view.typeName}.`);
};

const isDrizzleViewConfig = (value: unknown): value is DrizzleViewConfig<AnyRecord> =>
  isRecord(value) && isDataView(value.view) && isTable(value.table);

const createDrizzleViewConfigs = ({
  metadata,
  views,
}: {
  metadata?: DrizzleSchemaMetadata;
  views: DrizzleViewsInput;
}): Array<DrizzleViewConfig<AnyRecord>> => {
  if (Array.isArray(views)) {
    return views.map((view) => {
      if (isDrizzleViewConfig(view)) {
        return view;
      }

      if (!isDataView(view)) {
        throw new Error(`Expected a data view or Drizzle view config.`);
      }

      if (!metadata) {
        throw new Error(
          `Drizzle table for ${view.typeName} could not be inferred. Pass 'schema' to createDrizzleFate or use an explicit view config.`,
        );
      }

      const config = getDataViewSourceConfig(view);

      return {
        ...config,
        table: getTableForView(config.view, metadata),
      };
    });
  }

  if (!metadata) {
    throw new Error(
      `Drizzle tables could not be inferred. Pass 'schema' to createDrizzleFate or use explicit view configs.`,
    );
  }

  return collectDataViewConfigs(views).map((config) => ({
    ...config,
    table: getTableForView(config.view, metadata),
  }));
};

const inferDirectRelation = ({
  field,
  metadata,
  sourceConfig,
  targetConfig,
}: {
  field: string;
  metadata: DrizzleSchemaMetadata;
  sourceConfig: DrizzleViewConfig<AnyRecord>;
  targetConfig: DrizzleViewConfig<AnyRecord>;
}) => {
  const sourceTableConfig = getTableConfig({ config: sourceConfig, metadata });
  const targetTableConfig = getTableConfig({ config: targetConfig, metadata });
  const relation = sourceTableConfig.relations[field];

  if (!relation) {
    return null;
  }

  const normalized = normalizeRelation(metadata.schema, metadata.tableNamesMap, relation);

  return {
    foreignKey: getColumnKey(targetTableConfig.columns, normalized.references[0] as AnyColumn),
    localKey: getColumnKey(sourceTableConfig.columns, normalized.fields[0] as AnyColumn),
  };
};

const inferManyToManyRelation = ({
  field,
  metadata,
  sourceConfig,
  targetConfig,
}: {
  field: string;
  metadata: DrizzleSchemaMetadata;
  sourceConfig: DrizzleViewConfig<AnyRecord>;
  targetConfig: DrizzleViewConfig<AnyRecord>;
}) => {
  const sourceTableConfig = getTableConfig({ config: sourceConfig, metadata });
  const targetTableConfig = getTableConfig({ config: targetConfig, metadata });

  for (const joinTableConfig of Object.values(metadata.schema)) {
    if (joinTableConfig === sourceTableConfig || joinTableConfig === targetTableConfig) {
      continue;
    }

    let sourceJoin: { field: AnyColumn; reference: AnyColumn } | null = null;
    let targetJoin: { field: AnyColumn; reference: AnyColumn } | null = null;

    for (const relation of Object.values(joinTableConfig.relations)) {
      let normalized;
      try {
        normalized = normalizeRelation(metadata.schema, metadata.tableNamesMap, relation);
      } catch {
        continue;
      }
      const fieldColumn = normalized.fields[0] as AnyColumn | undefined;
      const referenceColumn = normalized.references[0] as AnyColumn | undefined;

      if (!fieldColumn || !referenceColumn) {
        continue;
      }

      if (includesColumn(sourceTableConfig.columns, referenceColumn)) {
        sourceJoin = { field: fieldColumn, reference: referenceColumn };
      } else if (includesColumn(targetTableConfig.columns, referenceColumn)) {
        targetJoin = { field: fieldColumn, reference: referenceColumn };
      }
    }

    if (!sourceJoin || !targetJoin) {
      continue;
    }

    const joinTable = metadata.fullSchema[joinTableConfig.tsName];
    if (!isTable(joinTable)) {
      continue;
    }

    sourceConfig.manyToMany = {
      ...sourceConfig.manyToMany,
      [field]: sourceConfig.manyToMany?.[field] ?? joinTable,
    };

    return {
      foreignKey: getColumnKey(targetTableConfig.columns, targetJoin.reference),
      localKey: getColumnKey(sourceTableConfig.columns, sourceJoin.reference),
      through: {
        foreignKey: getColumnKey(joinTableConfig.columns, targetJoin.field),
        localKey: getColumnKey(joinTableConfig.columns, sourceJoin.field),
      },
    };
  }

  return null;
};

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

export function createDrizzleSourceAdapter<Context>({
  db,
  schema,
  views,
}: DrizzleSourceAdapterOptions<Context>): DrizzleSourceAdapter<Context> {
  const metadata = getDrizzleSchemaMetadata({ db, schema });
  const viewConfigs = createDrizzleViewConfigs({ metadata, views }).map((config) => ({
    ...config,
    manyToMany: config.manyToMany ? { ...config.manyToMany } : undefined,
    relations: config.relations ? { ...config.relations } : undefined,
  }));
  const configsByView = new Map<DataView<AnyRecord>, DrizzleViewConfig<AnyRecord>>(
    viewConfigs.map((config) => [config.view, config]),
  );
  const configsByFields = new Map<DataView<AnyRecord>['fields'], DrizzleViewConfig<AnyRecord>>(
    viewConfigs.map((config) => [config.view.fields, config]),
  );
  const sourceDefinitions = createSourceDefinitions(viewConfigs, {
    resolveRelation: ({ config, field, kind, target }) => {
      if (!metadata) {
        return undefined;
      }

      const targetConfig =
        configsByView.get(target.view) ?? configsByFields.get(target.view.fields);
      if (!targetConfig) {
        return undefined;
      }

      return (
        inferDirectRelation({
          field,
          metadata,
          sourceConfig: config as DrizzleViewConfig<AnyRecord>,
          targetConfig,
        }) ??
        (kind === 'many'
          ? inferManyToManyRelation({
              field,
              metadata,
              sourceConfig: config as DrizzleViewConfig<AnyRecord>,
              targetConfig,
            })
          : undefined) ??
        undefined
      );
    },
  });
  const sourcesByView = new Map<DataView<AnyRecord>, Source>(
    sourceDefinitions.map((source) => [source.view, source]),
  );
  const sourcesByFields = new Map<DataView<AnyRecord>['fields'], Source>(
    sourceDefinitions.map((source) => [source.view.fields, source]),
  );
  const sourceConfigs = new Map<Source, RegisteredSourceConfig>(
    viewConfigs.map((config, index) => [
      sourceDefinitions[index] as Source,
      {
        ...toRegisteredConfig(config),
        source: sourceDefinitions[index] as Source,
      },
    ]),
  );

  const getSource = <Item extends AnyRecord = AnyRecord>(
    target: SourceTarget<Item>,
  ): SourceDefinition<Item, unknown> => {
    if (isSourceDefinition(target)) {
      return target;
    }

    const source = sourcesByView.get(target) ?? sourcesByFields.get(target.fields);
    if (!source) {
      throw new Error(`No source registered for view ${target.typeName}.`);
    }
    return source as SourceDefinition<Item, unknown>;
  };

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

  const buildSelection = (node: SourcePlanNode<any, any>, extraFields: Array<string> = []) => {
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
    node: SourcePlanNode<any, any>;
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
    node: SourcePlanNode<any, any>;
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
    node: SourcePlanNode<any, any>,
    ctx?: Context,
  ) => {
    if (items.length === 0) {
      return;
    }

    for (const [field, computed] of node.computeds) {
      if (!computed.select) {
        continue;
      }

      for (const [selectionName, selection] of Object.entries(computed.select)) {
        if (selection.kind !== 'count') {
          continue;
        }

        const sourceRelation = node.source.relations?.[selection.relation];
        if (
          !sourceRelation ||
          (sourceRelation.kind !== 'many' && sourceRelation.kind !== 'manyToMany')
        ) {
          throw new Error(
            `Computed count ${node.source.view.typeName}.${field} requires a collection relation named ${selection.relation}.`,
          );
        }

        const parentKeys = compactKeys(items.map((item) => item[sourceRelation.localKey]));
        if (parentKeys.length === 0) {
          continue;
        }
        const childSource = resolveSource(sourceRelation.source);
        const childConfig = getSourceConfig(childSource);
        let rows: Array<AnyRecord>;

        if (sourceRelation.kind === 'manyToMany') {
          const parentConfig = getSourceConfig(node.source);
          const throughConfig = parentConfig.manyToMany?.[selection.relation];

          if (!throughConfig) {
            throw new Error(
              `No Drizzle many-to-many table registered for ${node.source.view.typeName}.${selection.relation}.`,
            );
          }

          const through = resolveManyToManyConfig({
            field: selection.relation,
            source: node.source,
            sourceRelation,
            through: throughConfig,
          });

          rows = (await getDb(ctx)
            .select({
              count: sql<number>`count(*)`.mapWith(Number),
              parentKey: through.localColumn,
            })
            .from(through.table)
            .innerJoin(
              childConfig.table,
              eq(through.foreignColumn, getColumn(childConfig.columns, sourceRelation.foreignKey)),
            )
            .where(
              and(
                inArray(through.localColumn, parentKeys),
                whereFromCountSelection(childConfig.columns, selection.where),
              ),
            )
            .groupBy(through.localColumn)) as Array<AnyRecord>;
        } else {
          const parentKeyColumn = getColumn(childConfig.columns, sourceRelation.foreignKey);
          rows = (await getDb(ctx)
            .select({
              count: sql<number>`count(*)`.mapWith(Number),
              parentKey: parentKeyColumn,
            })
            .from(childConfig.table)
            .where(
              and(
                inArray(parentKeyColumn, parentKeys),
                whereFromCountSelection(childConfig.columns, selection.where),
              ),
            )
            .groupBy(parentKeyColumn)) as Array<AnyRecord>;
        }

        const counts = new Map(rows.map((row: AnyRecord) => [row.parentKey, row.count]));

        for (const item of items) {
          attachComputedState(item, field, {
            [selectionName]: counts.get(item[sourceRelation.localKey]) ?? 0,
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
    relationNode: SourcePlanNode<any, any>;
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
    relationNode: SourcePlanNode<any, any>,
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
    node: SourcePlanNode<any, any>;
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
    relationNode: SourcePlanNode<any, any>,
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
    node: SourcePlanNode<any, any>;
    relationField: string;
    relationNode: SourcePlanNode<any, any>;
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
    node: SourcePlanNode<any, any>,
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
    plan: SourcePlan<Item, Context>;
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
    plan: SourcePlan<Item, Context>;
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
    plan: SourcePlan<Item, Context>;
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
    sourceDefinitions.map((source) => [
      source as Source,
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
    getSource,
    registry,
  };
}

export const createDrizzleSourceRegistry = <Context>(
  options: Parameters<typeof createDrizzleSourceAdapter<Context>>[0],
) => createDrizzleSourceAdapter<Context>(options).registry;

export function createDrizzleFate<Context, Procedure extends ProcedureLike>({
  procedure,
  ...options
}: Parameters<typeof createDrizzleSourceAdapter<Context>>[0] & {
  procedure: Procedure;
}) {
  const adapter = createDrizzleSourceAdapter<Context>(options);
  const connection = withConnection(procedure);
  const procedures = bindSourceProcedures<Context, Procedure, typeof connection>({
    createConnectionProcedure: connection,
    procedure,
    registry: adapter.registry,
  });

  return {
    ...adapter,
    connection,
    createPlan: <Item extends AnyRecord = AnyRecord>({
      args,
      ctx,
      select,
      view,
    }: SourceInput & {
      ctx?: Context;
      view: ViewTarget<Item>;
    }) =>
      createSourcePlan({
        args,
        ctx,
        select,
        source: adapter.getSource(view),
      }),
    procedures: <
      Item extends AnyRecord,
      ById extends boolean | undefined = undefined,
      List extends boolean | ListConfig | undefined = undefined,
      Live extends false | LiveConfig | undefined = undefined,
    >(
      input: ViewProcedureInput<Item, ById, List, Live>,
    ) => {
      const procedureInput = input as any;
      const options =
        procedureInput && typeof procedureInput === 'object' && 'view' in procedureInput
          ? { ...procedureInput, source: adapter.getSource(procedureInput.view) }
          : adapter.getSource(input as ViewTarget<Item>);
      return procedures<Item, ById, List, Live>(options);
    },
    resolveById: <Item extends AnyRecord = AnyRecord>({
      ctx,
      extra,
      id,
      input,
      view,
    }: {
      ctx: Context;
      extra?: DrizzleQueryExtra;
      id: string;
      input: SourceInput;
      view: ViewTarget<Item>;
    }) =>
      resolveSourceById({
        ctx,
        extra,
        id,
        input,
        registry: adapter.registry,
        source: adapter.getSource(view),
      }),
    resolveByIds: <Item extends AnyRecord = AnyRecord>({
      ctx,
      extra,
      ids,
      input,
      view,
    }: {
      ctx: Context;
      extra?: DrizzleQueryExtra;
      ids: Array<string>;
      input: SourceInput;
      view: ViewTarget<Item>;
    }) =>
      resolveSourceByIds({
        ctx,
        extra,
        ids,
        input,
        registry: adapter.registry,
        source: adapter.getSource(view),
      }),
    resolveConnection: <Item extends AnyRecord = AnyRecord>({
      ctx,
      cursor,
      direction,
      extra,
      input,
      skip,
      take,
      view,
    }: {
      ctx: Context;
      cursor?: string;
      direction: 'backward' | 'forward';
      extra?: DrizzleQueryExtra;
      input: SourceInput;
      skip?: number;
      take: number;
      view: ViewTarget<Item>;
    }) =>
      resolveSourceConnection({
        ctx,
        cursor,
        direction,
        extra,
        input,
        registry: adapter.registry,
        skip,
        source: adapter.getSource(view),
        take,
      }),
  };
}
