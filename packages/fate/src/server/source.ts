import type { AnyRecord } from '../types.ts';
import { createViewPlan, type DataView, type ViewPlan, type ViewPlanNode } from './dataView.ts';
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

type OneSourceRelationConfig = SourceRelationKeyConfig & {
  orderBy?: never;
  through?: never;
};

type OrderedSourceRelationConfig = SourceRelationKeyConfig & {
  orderBy?: SourceOrder;
};

type ManySourceRelationConfig = OrderedSourceRelationConfig & {
  through?: never;
};

type ManyToManySourceRelationConfig = OrderedSourceRelationConfig & {
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

export const asc = (field: string): SourceOrderField => ({
  direction: 'asc',
  field,
});

export const desc = (field: string): SourceOrderField => ({
  direction: 'desc',
  field,
});

export function defineSource<Item extends AnyRecord, Adapter = unknown>(
  view: DataView<Item>,
  config: Omit<SourceDefinition<Item, Adapter>, 'view'>,
): SourceDefinition<Item, Adapter> {
  return {
    ...config,
    view,
  };
}

export const one = <Item extends AnyRecord, Adapter = unknown>(
  source: SourceReference<Item, Adapter>,
  config: OneSourceRelationConfig,
): SourceRelation<Item, Adapter> => ({
  ...config,
  kind: 'one',
  source,
});

export const many = <Item extends AnyRecord, Adapter = unknown>(
  source: SourceReference<Item, Adapter>,
  config: ManySourceRelationConfig,
): SourceRelation<Item, Adapter> => ({
  ...config,
  kind: 'many',
  source,
});

export const manyToMany = <Item extends AnyRecord, Adapter = unknown>(
  source: SourceReference<Item, Adapter>,
  config: ManyToManySourceRelationConfig,
): SourceRelation<Item, Adapter> => ({
  ...config,
  kind: 'manyToMany',
  source,
});

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
    base.push(asc(source.id));
  }

  return base.length ? base : [asc(source.id)];
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
