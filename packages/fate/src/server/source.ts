import type { AnyRecord } from '../types.ts';
import {
  createViewPlan,
  getBaseDataView,
  getDataViewListOptions,
  isDataView,
  type DataView,
  type DataViewOrderBy,
  type ViewPlan,
  type ViewPlanNode,
} from './dataView.ts';
import { getScopedArgs } from './queryArgs.ts';

export type OrderDirection = 'asc' | 'desc';

export type SourceOrderField = {
  direction: OrderDirection;
  field: string;
};

export type SourceOrder = Array<SourceOrderField>;

export type SourceReference<Item extends AnyRecord = AnyRecord, Adapter = unknown> =
  | SourceDefinition<Item, Adapter>
  | (() => SourceDefinition<Item, Adapter>);

type SourceRelationBase<Item extends AnyRecord = AnyRecord, Adapter = unknown> = {
  foreignKey: string;
  localKey: string;
  source: SourceReference<Item, Adapter>;
};

export type SourceRelation<
  Item extends AnyRecord = AnyRecord,
  Adapter = unknown,
> = SourceRelationBase<Item, Adapter> &
  (
    | {
        kind: 'one';
        orderBy?: never;
        through?: never;
      }
    | {
        kind: 'many';
        orderBy?: SourceOrder;
        through?: never;
      }
    | {
        kind: 'manyToMany';
        orderBy?: SourceOrder;
        through?: {
          foreignKey: string;
          localKey: string;
        };
      }
  );

type SourceRelationKeyConfig = {
  foreignKey: string;
  localKey: string;
};

export type SourceRelationConfig = Partial<SourceRelationKeyConfig> & {
  orderBy?: SourceOrder;
  through?: {
    foreignKey: string;
    localKey: string;
  };
};

export type SourceDefinition<Item extends AnyRecord = AnyRecord, Adapter = unknown> = {
  adapter?: Adapter;
  id: string;
  orderBy?: SourceOrder;
  relations?: Record<string, SourceRelation<AnyRecord, Adapter>>;
  view: DataView<Item>;
};

export type SourceConfig<Item extends AnyRecord = AnyRecord, Adapter = unknown> = {
  adapter?: Adapter;
  id?: string;
  orderBy?: SourceOrder;
  relations?: Record<string, SourceRelationConfig>;
  view: DataView<Item>;
};

export type SourcePlanNode<Context = unknown, Adapter = unknown> = ViewPlanNode<Context> & {
  orderBy: SourceOrder;
  relations: Map<string, SourcePlanNode<Context, Adapter>>;
  source: SourceDefinition<AnyRecord, Adapter>;
};

export type SourcePlan<
  Item extends AnyRecord = AnyRecord,
  Context = unknown,
  Adapter = unknown,
> = Omit<ViewPlan<Item, Context>, 'root'> & {
  root: SourcePlanNode<Context, Adapter>;
  source: SourceDefinition<Item, Adapter>;
};

const ascending = (field: string): SourceOrderField => ({ direction: 'asc', field });

const toSourceOrder = (orderBy?: DataViewOrderBy): SourceOrder | undefined => {
  if (!orderBy) {
    return undefined;
  }

  const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
  const sourceOrder = entries.flatMap((entry) =>
    Object.entries(entry).map(([field, direction]) => ({ direction, field })),
  );

  return sourceOrder.length ? sourceOrder : undefined;
};

export const getDataViewSourceConfig = (input: DataView<AnyRecord>): SourceConfig<AnyRecord> => {
  const view = getBaseDataView(input);
  const orderBy = toSourceOrder(getDataViewListOptions(input)?.orderBy);

  return {
    ...(orderBy ? { orderBy } : null),
    view,
  };
};

export type DataViewModule = Record<string, unknown>;

export const collectDataViewConfigs = (input: DataViewModule): Array<SourceConfig<AnyRecord>> => {
  const configsByFields = new Map<DataView<AnyRecord>['fields'], SourceConfig<AnyRecord>>();
  const seenValues = new Set<unknown>();

  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || seenValues.has(value)) {
      return;
    }

    seenValues.add(value);

    if (isDataView(value)) {
      const config = getDataViewSourceConfig(value);
      const existingConfig = configsByFields.get(config.view.fields);

      if (existingConfig) {
        if (config.orderBy) {
          existingConfig.orderBy = config.orderBy;
        }
      } else {
        configsByFields.set(config.view.fields, config);
      }

      for (const field of Object.values(config.view.fields)) {
        visit(field);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry);
      }
      return;
    }

    for (const [key, entry] of Object.entries(value)) {
      if (key === 'Root') {
        continue;
      }
      visit(entry);
    }
  };

  visit(input);

  return [...configsByFields.values()];
};

export function createSourceDefinition<Item extends AnyRecord, Adapter = unknown>(
  view: DataView<Item>,
  config: Omit<SourceDefinition<Item, Adapter>, 'view' | 'relations'> & {
    relations?: Record<string, SourceRelationConfig>;
  },
): SourceDefinition<Item, Adapter> {
  return {
    ...config,
    relations: undefined,
    view,
  };
}

export const getRelationView = (
  view: DataView<AnyRecord>,
  field: string,
): { kind: 'many' | 'one'; orderBy?: SourceOrder; view: DataView<AnyRecord> } | null => {
  const config = view.fields[field];

  if (!isDataView(config)) {
    return null;
  }

  const orderBy = toSourceOrder(getDataViewListOptions(config)?.orderBy);

  return {
    kind: config.kind === 'list' ? 'many' : 'one',
    ...(orderBy ? { orderBy } : null),
    view: config,
  };
};

type SourceRelationContext<Adapter = unknown> = {
  config: SourceConfig<AnyRecord, Adapter>;
  field: string;
  kind: 'many' | 'one';
  source: SourceDefinition<AnyRecord, Adapter>;
  target: SourceDefinition<AnyRecord, Adapter>;
};

export function createSourceDefinitions<Adapter = unknown>(
  configs: Array<SourceConfig<AnyRecord, Adapter>>,
  options?: {
    resolveRelation?: (context: SourceRelationContext<Adapter>) => SourceRelationConfig | undefined;
  },
): Array<SourceDefinition<AnyRecord, Adapter>> {
  const sources = configs.map((config) =>
    createSourceDefinition(config.view, {
      adapter: config.adapter,
      id: config.id ?? 'id',
      orderBy: config.orderBy,
    }),
  );

  const sourcesByView = new Map<DataView<AnyRecord>, SourceDefinition<AnyRecord, Adapter>>();
  const sourcesByFields = new Map<
    DataView<AnyRecord>['fields'],
    SourceDefinition<AnyRecord, Adapter>
  >();

  for (const source of sources) {
    sourcesByView.set(source.view, source);
    sourcesByFields.set(source.view.fields, source);
  }

  for (const [index, config] of configs.entries()) {
    const source = sources[index] as SourceDefinition<AnyRecord, Adapter>;

    const relations: Record<string, SourceRelation<AnyRecord, Adapter>> = {};
    const relationFields = new Set([
      ...Object.keys(config.relations ?? {}),
      ...Object.keys(config.view.fields).filter((field) => getRelationView(config.view, field)),
    ]);

    for (const field of relationFields) {
      const relationView = getRelationView(config.view, field);
      if (!relationView) {
        throw new Error(
          `Source ${config.view.typeName}.${field} must reference a data view relation.`,
        );
      }

      const relationSource =
        sourcesByView.get(relationView.view) ?? sourcesByFields.get(relationView.view.fields);

      if (!relationSource) {
        throw new Error(
          `Source ${config.view.typeName}.${field} references an unregistered data view.`,
        );
      }

      const relationConfig = {
        ...options?.resolveRelation?.({
          config,
          field,
          kind: relationView.kind,
          source,
          target: relationSource,
        }),
        ...(relationView.orderBy ? { orderBy: relationView.orderBy } : null),
        ...(config.relations?.[field] ?? {}),
      };

      if (!relationConfig.foreignKey || !relationConfig.localKey) {
        throw new Error(
          `Source ${config.view.typeName}.${field} requires foreignKey and localKey relation metadata.`,
        );
      }

      relations[field] = {
        ...relationConfig,
        kind: relationConfig.through ? 'manyToMany' : relationView.kind,
        source: relationSource,
      } as SourceRelation<AnyRecord, Adapter>;
    }

    if (Object.keys(relations).length > 0) {
      source.relations = relations;
    }
  }

  return sources;
}

export const hasNestedSelection = (select: Iterable<string>, field: string) => {
  for (const path of select) {
    if (path === field || path.startsWith(`${field}.`)) {
      return true;
    }
  }

  return false;
};

export const getNestedSelection = (select: Iterable<string>, field: string): Array<string> => {
  const nested: Array<string> = [];

  for (const path of select) {
    if (path.startsWith(`${field}.`)) {
      nested.push(path.slice(field.length + 1));
    }
  }

  return nested;
};

export const getNestedSourceInput = (
  input: {
    args?: Record<string, unknown>;
    select: Iterable<string>;
  },
  field: string,
) => ({
  args: getScopedArgs(input.args, field),
  select: getNestedSelection(input.select, field),
});

const resolveSourceReference = <Adapter = unknown>(
  source: SourceReference<AnyRecord, Adapter>,
): SourceDefinition<AnyRecord, Adapter> => (typeof source === 'function' ? source() : source);

export const getSourceOrder = <Adapter = unknown>(
  source: SourceDefinition<AnyRecord, Adapter>,
  override?: SourceOrder,
): SourceOrder => {
  const base = [...(override ?? source.orderBy ?? [])];
  const hasId = base.some((entry) => entry.field === source.id);

  if (!hasId) {
    base.push(ascending(source.id));
  }

  return base.length ? base : [ascending(source.id)];
};

const attachSourceNode = <Context, Adapter = unknown>(
  node: ViewPlanNode<Context>,
  source: SourceDefinition<AnyRecord, Adapter>,
  overrideOrder?: SourceOrder,
): SourcePlanNode<Context, Adapter> => {
  const relations = new Map<string, SourcePlanNode<Context, Adapter>>();

  for (const [field, relationNode] of node.relations) {
    const relation = source.relations?.[field];
    if (!relation) {
      continue;
    }

    const relationSource = resolveSourceReference(relation.source);
    relations.set(field, attachSourceNode(relationNode, relationSource, relation.orderBy));
  }

  return {
    ...node,
    orderBy: getSourceOrder(source, overrideOrder),
    relations,
    source,
  };
};

export function createSourcePlan<Item extends AnyRecord, Context = unknown, Adapter = unknown>({
  args,
  ctx,
  select,
  source,
}: {
  args?: Record<string, unknown>;
  ctx?: Context;
  select: Iterable<string>;
  source: SourceDefinition<Item, Adapter>;
}) {
  const plan = createViewPlan({
    args,
    ctx,
    select,
    view: source.view,
  });

  return {
    ...plan,
    root: attachSourceNode(plan.root, source),
    source,
  } satisfies SourcePlan<Item, Context, Adapter>;
}

export function createNestedSourcePlan<
  Item extends AnyRecord,
  Context = unknown,
  Adapter = unknown,
>({
  ctx,
  field,
  input,
  source,
}: {
  ctx?: Context;
  field: string;
  input: {
    args?: Record<string, unknown>;
    select: Iterable<string>;
  };
  source: SourceDefinition<Item, Adapter>;
}) {
  return createSourcePlan({
    ...getNestedSourceInput(input, field),
    ctx,
    source,
  });
}

const cursorEncoding = 'base64url';

export const encodeCursor = (orderBy: SourceOrder, item: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(orderBy.map((entry) => item[entry.field])), 'utf8').toString(
    cursorEncoding,
  );

export const decodeCursor = (cursor?: string): Array<unknown> | undefined => {
  if (!cursor) {
    return undefined;
  }

  return JSON.parse(Buffer.from(cursor, cursorEncoding).toString('utf8')) as Array<unknown>;
};

export type KeysetStep = {
  compare: {
    field: string;
    op: 'gt' | 'lt';
    value: unknown;
  };
  equals: Array<{
    field: string;
    value: unknown;
  }>;
};

export const createKeysetSteps = (
  orderBy: SourceOrder,
  values: Array<unknown>,
  direction: 'backward' | 'forward',
): Array<KeysetStep> =>
  orderBy.map((entry, index) => ({
    compare: {
      field: entry.field,
      op:
        (entry.direction === 'asc' && direction === 'forward') ||
        (entry.direction === 'desc' && direction === 'backward')
          ? 'gt'
          : 'lt',
      value: values[index],
    },
    equals: orderBy.slice(0, index).map((previous, previousIndex) => ({
      field: previous.field,
      value: values[previousIndex],
    })),
  }));
