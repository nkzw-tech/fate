import { prismaSelect } from './prismaSelect.tsx';

type AnyRecord = Record<string, unknown>;

type ResolverSelect<Context> =
  | AnyRecord
  | ((options: { args?: AnyRecord; context?: Context }) => AnyRecord | void);

type Bivariant<Fn extends (...args: Array<any>) => unknown> = {
  bivarianceHack(...args: Parameters<Fn>): ReturnType<Fn>;
}['bivarianceHack'];

type ResolverResolve<Item extends AnyRecord, Context> = Bivariant<
  (options: {
    args?: AnyRecord;
    context?: Context;
    item: Item;
  }) => Promise<unknown> | unknown
>;

export type ResolverField<Item extends AnyRecord, Context> = {
  kind: 'resolver';
  resolve: ResolverResolve<Item, Context>;
  select?: ResolverSelect<Context>;
};

const dataViewFieldsKey = '__fateDataViewFields';

type DataField<Item extends AnyRecord, Context> =
  | true
  | DataView<AnyRecord, Context>
  | ResolverField<Item, Context>;

export type Serializable<T> = T extends Date
  ? string
  : T extends Array<infer U>
    ? Array<Serializable<U>>
    : T extends object
      ? { [K in keyof T]: Serializable<T[K]> }
      : T;

export type DataView<Item extends AnyRecord, Context = unknown> = {
  fields: Record<string, DataField<Item, Context>>;
};

export type DataViewConfig<Item extends AnyRecord, Context> = Record<
  string,
  DataField<Item, Context>
>;

export function dataView<Item extends AnyRecord, Context = unknown>() {
  return <Fields extends DataViewConfig<Item, Context>>(fields: Fields) =>
    ({
      [dataViewFieldsKey]: fields,
      fields,
    }) as DataView<Item, Context> & {
      readonly __fateDataViewFields: Fields;
    };
}

export function resolver<Item extends AnyRecord, Context = unknown>(config: {
  resolve: ResolverResolve<Item, Context>;
  select?: ResolverSelect<Context>;
}): ResolverField<Item, Context> {
  return {
    kind: 'resolver',
    ...config,
  };
}

type NonNullish<T> = Exclude<T, null | undefined>;

type WithNullish<Original, Value> = null extends Original
  ? undefined extends Original
    ? Value | null | undefined
    : Value | null
  : undefined extends Original
    ? Value | undefined
    : Value;

type ResolverResult<Field> =
  Field extends ResolverField<AnyRecord, unknown>
    ? Awaited<ReturnType<Field['resolve']>>
    : never;

type RelationResult<ItemField, V extends DataView<AnyRecord, unknown>> =
  NonNullish<ItemField> extends Array<unknown>
    ? WithNullish<ItemField, Array<RawDataViewResult<V>>>
    : WithNullish<ItemField, RawDataViewResult<V>>;

type ViewFieldConfig<V extends DataView<AnyRecord, unknown>> = V extends {
  readonly __fateDataViewFields: infer Fields;
}
  ? Fields
  : V['fields'];

type RawFieldResult<
  Item extends AnyRecord,
  Key extends PropertyKey,
  Field extends DataField<Item, unknown>,
> = Field extends true
  ? Key extends keyof Item
    ? Item[Key]
    : never
  : Field extends DataView<infer ChildItem, unknown>
    ? Key extends keyof Item
      ? RelationResult<Item[Key], DataView<ChildItem, unknown>>
      : never
    : Field extends ResolverField<Item, unknown>
      ? ResolverResult<Field>
      : never;

type RawDataViewResult<V extends DataView<AnyRecord, unknown>> =
  V extends DataView<infer Item, unknown>
    ? {
        [K in keyof ViewFieldConfig<V>]: RawFieldResult<
          Item,
          K,
          ViewFieldConfig<V>[K]
        >;
      }
    : never;

export type DataViewResult<V extends DataView<AnyRecord, unknown>> =
  Serializable<RawDataViewResult<V>>;

type SelectedViewNode<Context> = {
  path: string | null;
  relations: Map<string, SelectedViewNode<Context>>;
  resolvers: Map<string, ResolverField<AnyRecord, Context>>;
  view: DataView<AnyRecord, Context>;
};

const isResolverField = <Item extends AnyRecord, Context>(
  field: DataField<Item, Context>,
): field is ResolverField<Item, Context> =>
  Boolean(field) &&
  typeof field === 'object' &&
  'kind' in field &&
  field.kind === 'resolver';

const isDataViewField = <Context>(
  field: DataField<AnyRecord, Context>,
): field is DataView<AnyRecord, Context> =>
  Boolean(field) && typeof field === 'object' && 'fields' in field;

const isPlainObject = (value: unknown): value is AnyRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const mergeObject = (target: AnyRecord, source: AnyRecord) => {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      mergeObject(existing, value);
      continue;
    }
    target[key] = value;
  }
};

const ensureRelationSelect = (
  select: AnyRecord,
  path: string | null,
): AnyRecord => {
  if (!path) {
    return select;
  }

  const segments = path.split('.');
  let current = select;

  for (const segment of segments) {
    const existing = current[segment];

    if (isPlainObject(existing) && 'select' in existing) {
      const relation = existing as AnyRecord & { select?: AnyRecord };
      if (!isPlainObject(relation.select)) {
        relation.select = {};
      }
      current = relation.select!;
      continue;
    }

    const relation = { select: {} as AnyRecord };
    current[segment] = relation;
    current = relation.select;
  }

  return current;
};

type CreateDataViewSelectionOptions<Item extends AnyRecord, Context> = {
  args?: AnyRecord;
  context?: Context;
  paths: Iterable<string>;
  view: DataView<Item, Context>;
};

type ResolveOptions<Item extends AnyRecord, Context> = {
  item: Item;
  node: SelectedViewNode<Context>;
  options: {
    args?: AnyRecord;
    context?: Context;
  };
};

const createSelectedNode = <Context>(
  view: DataView<AnyRecord, Context>,
  path: string | null,
): SelectedViewNode<Context> => ({
  path,
  relations: new Map(),
  resolvers: new Map(),
  view,
});

const assignPath = <Context>(
  node: SelectedViewNode<Context>,
  segments: Array<string>,
  path: string | null,
  view: DataView<AnyRecord, Context>,
  allowedPaths: Set<string>,
) => {
  if (segments.length === 0) {
    return;
  }

  const [segment, ...rest] = segments;
  const field = view.fields[segment];

  if (!field) {
    return;
  }

  const nextPath = path ? `${path}.${segment}` : segment;

  if (isResolverField(field)) {
    if (rest.length === 0) {
      node.resolvers.set(segment, field);
    }
    return;
  }

  if (isDataViewField(field)) {
    let relationNode = node.relations.get(segment);
    if (!relationNode) {
      relationNode = createSelectedNode(field, nextPath);
      node.relations.set(segment, relationNode);
    }

    if (rest.length === 0) {
      collectViewPaths(nextPath, field, allowedPaths);
      return;
    }

    assignPath(relationNode, rest, nextPath, field, allowedPaths);
    return;
  }

  if (rest.length === 0) {
    allowedPaths.add(nextPath);
  }
};

const collectViewPaths = <Context>(
  basePath: string,
  view: DataView<AnyRecord, Context>,
  allowedPaths: Set<string>,
) => {
  for (const [field, child] of Object.entries(view.fields)) {
    const nextPath = `${basePath}.${field}`;

    if (child === true) {
      allowedPaths.add(nextPath);
      continue;
    }

    if (isDataViewField(child)) {
      collectViewPaths(nextPath, child, allowedPaths);
    }
  }
};

const collectResolvers = <Context>(
  node: SelectedViewNode<Context>,
  select: AnyRecord,
  args?: AnyRecord,
  context?: Context,
) => {
  for (const resolver of node.resolvers.values()) {
    if (!resolver.select) {
      continue;
    }

    const addition =
      typeof resolver.select === 'function'
        ? resolver.select({ args, context })
        : resolver.select;

    if (addition && isPlainObject(addition)) {
      const target = ensureRelationSelect(select, node.path);
      mergeObject(target, addition);
    }
  }

  for (const relation of node.relations.values()) {
    collectResolvers(relation, select, args, context);
  }
};

const resolveNode = async <Item extends AnyRecord, Context>(
  options: ResolveOptions<Item, Context>,
): Promise<Item> => {
  const { item, node, options: resolverOptions } = options;

  if (!isPlainObject(item)) {
    return item;
  }

  let result: AnyRecord | null = null;

  const assign = (key: string, value: unknown) => {
    if (!result) {
      result = { ...item };
    }
    result[key] = value;
  };

  const base = () => result ?? item;

  for (const [field, resolver] of node.resolvers) {
    const value = await resolver.resolve({
      ...resolverOptions,
      item: base() as Item,
    });

    if (value !== undefined) {
      assign(field, value);
    }
  }

  for (const [field, relationNode] of node.relations) {
    const current = base()[field];

    if (Array.isArray(current)) {
      const resolved = await Promise.all(
        current.map((entry) =>
          resolveNode({
            item: entry as AnyRecord,
            node: relationNode,
            options: resolverOptions,
          }),
        ),
      );

      const changed = resolved.some((value, index) => value !== current[index]);
      if (changed) {
        assign(field, resolved);
      }
      continue;
    }

    if (current && typeof current === 'object') {
      const resolved = await resolveNode({
        item: current as AnyRecord,
        node: relationNode,
        options: resolverOptions,
      });

      if (resolved !== current) {
        assign(field, resolved);
      }
    }
  }

  return (result ?? item) as Item;
};

export function createDataViewSelection<
  Item extends AnyRecord,
  Context = unknown,
>({
  args,
  context,
  paths,
  view,
}: CreateDataViewSelectionOptions<Item, Context>) {
  const allowedPaths = new Set<string>();
  const root = createSelectedNode(view, null);

  for (const path of paths) {
    if (!path) {
      continue;
    }

    assignPath(root, path.split('.'), null, view, allowedPaths);
  }

  const select = prismaSelect([...allowedPaths], args);
  collectResolvers(root, select, args, context);

  return {
    resolve: async (item: Item): Promise<Item> =>
      resolveNode({
        item,
        node: root,
        options: { args, context },
      }),
    resolveMany: async (items: Array<Item>): Promise<Array<Item>> =>
      Promise.all(
        items.map((item) =>
          resolveNode({
            item,
            node: root,
            options: { args, context },
          }),
        ),
      ),
    select,
  };
}
