import type { AnyRecord } from '../types.ts';
import { createViewPlan, type DataView, type ViewPlan, type ViewPlanNode } from './dataView.ts';

export type OrderDirection = 'asc' | 'desc';

export type SourceOrderField = {
  direction: OrderDirection;
  field: string;
};

export type SourceOrder = Array<SourceOrderField>;

export type SourceReference<Item extends AnyRecord = AnyRecord, Adapter = unknown> =
  | SourceDefinition<Item, Adapter>
  | (() => SourceDefinition<Item, Adapter>);

export type SourceRelation<Item extends AnyRecord = AnyRecord, Adapter = unknown> = {
  foreignKey: string;
  kind: 'many' | 'manyToMany' | 'one';
  localKey: string;
  orderBy?: SourceOrder;
  source: SourceReference<Item, Adapter>;
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

export type ExecutionPlanNode<Context = unknown, Adapter = unknown> = ViewPlanNode<Context> & {
  orderBy: SourceOrder;
  relations: Map<string, ExecutionPlanNode<Context, Adapter>>;
  source: SourceDefinition<AnyRecord, Adapter>;
};

export type ExecutionPlan<
  Item extends AnyRecord = AnyRecord,
  Context = unknown,
  Adapter = unknown,
> = Omit<ViewPlan<Item, Context>, 'root'> & {
  root: ExecutionPlanNode<Context, Adapter>;
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
): ExecutionPlanNode<Context, Adapter> => {
  const relations = new Map<string, ExecutionPlanNode<Context, Adapter>>();

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

export function createExecutionPlan<Item extends AnyRecord, Context = unknown, Adapter = unknown>({
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
  } satisfies ExecutionPlan<Item, Context, Adapter>;
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
