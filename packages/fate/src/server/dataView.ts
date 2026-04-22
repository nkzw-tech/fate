import { isRecord } from '../record.ts';
import { AnyRecord } from '../types.ts';
import { isConnectionResult, toConnectionResult, type ConnectionResult } from './connection.ts';
import { toPrismaSelect } from './prismaSelect.ts';
import { getScopedArgs } from './queryArgs.ts';

const dataViewFieldsKey = Symbol('__fate__DataViewFields');
const computedStateKey = Symbol('__fate__ComputedState');

type ResolverSelect<Context> =
  | AnyRecord
  | ((options: { args?: AnyRecord; context?: Context }) => AnyRecord | void);

type Bivariant<Fn extends (...args: Array<any>) => unknown> = {
  bivariance(...args: Parameters<Fn>): ReturnType<Fn>;
}['bivariance'];

type ResolverResolve<Item extends AnyRecord, Result, Context> = Bivariant<
  (item: Item, context?: Context, args?: AnyRecord) => Promise<Result> | Result
>;

type ResolverAuthorize<Item extends AnyRecord, Context> = Bivariant<
  (item: Item, context?: Context, args?: AnyRecord) => Promise<boolean> | boolean
>;

export type FieldNeed = {
  kind: 'field';
  path: string;
};

export type CountNeed = {
  kind: 'count';
  relation: string;
  where?: AnyRecord;
};

export type ComputedNeed = CountNeed | FieldNeed;

type ComputedDeps<Needs extends Record<string, ComputedNeed> | undefined> =
  Needs extends Record<string, ComputedNeed>
    ? {
        [Key in keyof Needs]: Needs[Key] extends CountNeed
          ? number
          : Needs[Key] extends FieldNeed
            ? unknown
            : never;
      }
    : Record<string, unknown>;

type ComputedResolve<
  Item extends AnyRecord,
  Result,
  Needs extends Record<string, ComputedNeed> | undefined,
  Context,
> = Bivariant<
  (
    item: Item,
    deps: ComputedDeps<Needs>,
    context?: Context,
    args?: AnyRecord,
  ) => Promise<Result> | Result
>;

/**
 * Field configuration for selecting and resolving a computed value on the backend.
 */
export type ResolverField<Item extends AnyRecord, Result, Context> = {
  authorize?: ResolverAuthorize<Item, Context>;
  kind: 'resolver';
  resolve: ResolverResolve<Item, Result, Context>;
  select?: ResolverSelect<Context>;
};

export type ComputedField<
  Item extends AnyRecord,
  Result,
  Context,
  Needs extends Record<string, ComputedNeed> | undefined = Record<string, ComputedNeed>,
> = {
  authorize?: ResolverAuthorize<Item, Context>;
  kind: 'computed';
  needs?: Needs;
  resolve: ComputedResolve<Item, Result, Needs, Context>;
};

type DataField<Item extends AnyRecord> =
  | true
  | ComputedField<Item, any, any, any>
  | DataView<AnyRecord>
  | ResolverField<Item, any, any>;

/**
 * Recursively serializes resolver results for transport across the network.
 */
export type Serializable<T> = T extends Date
  ? string
  : T extends Array<infer U>
    ? Array<Serializable<U>>
    : T extends object
      ? { [K in keyof T]: Serializable<T[K]> }
      : T;

/**
 * Server-side mirror of a view definition describing how to select and resolve
 * fields when fulfilling a client request.
 */
export type DataView<Item extends AnyRecord> = {
  fields: Record<string, DataField<Item>>;
  kind?: 'resolver' | 'list';
  typeName: string;
};

/**
 * Convenience type for declaring the fields of a server data view.
 */
export type DataViewConfig<Item extends AnyRecord> = Record<string, DataField<Item>>;

/**
 * Declares a server data view that exposes an object's available fields to the client.
 *
 * @example
 * const Post = dataView<PostItem>('Post')({
 *   id: true,
 *   title: true,
 * });
 */
export function dataView<Item extends AnyRecord>(typeName: string) {
  return <Fields extends DataViewConfig<Item>>(fields: Fields) => {
    return {
      [dataViewFieldsKey]: fields,
      fields,
      typeName,
    } as DataView<Item> & {
      readonly [dataViewFieldsKey]: Fields;
    };
  };
}

/**
 * Marks a data view as a list resolver so the server can respond with
 * connection information.
 */
export const list = <Item extends AnyRecord>(view: DataView<Item>) => {
  return { ...view, kind: 'list' as const };
};

/**
 * Declares a resolver field inside a data view, optionally providing a
 * selection for any data dependencies.
 */
export function resolver<Item extends AnyRecord, Result = unknown, Context = unknown>(config: {
  authorize?: ResolverAuthorize<Item, Context>;
  resolve: ResolverResolve<Item, Result, Context>;
  select?: ResolverSelect<Context>;
}): ResolverField<Item, Result, Context> {
  return {
    kind: 'resolver' as const,
    ...config,
  };
}

export const field = (path: string): FieldNeed => ({
  kind: 'field',
  path,
});

export const count = (relation: string, options?: { where?: AnyRecord }): CountNeed => ({
  kind: 'count',
  relation,
  where: options?.where,
});

export function computed<
  Item extends AnyRecord,
  Result = unknown,
  Context = unknown,
  Needs extends Record<string, ComputedNeed> | undefined = Record<string, ComputedNeed>,
>(config: {
  authorize?: ResolverAuthorize<Item, Context>;
  needs?: Needs;
  resolve: ComputedResolve<Item, Result, Needs, Context>;
}): ComputedField<Item, Result, Context, Needs> {
  return {
    kind: 'computed' as const,
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
  Field extends ResolverField<AnyRecord, any, any>
    ? Field['authorize'] extends ResolverAuthorize<any, any>
      ? Awaited<ReturnType<Field['resolve']>> | null
      : Awaited<ReturnType<Field['resolve']>>
    : never;

type ComputedResult<Field> =
  Field extends ComputedField<AnyRecord, any, any, any>
    ? Field['authorize'] extends ResolverAuthorize<any, any>
      ? Awaited<ReturnType<Field['resolve']>> | null
      : Awaited<ReturnType<Field['resolve']>>
    : never;

type RelationResult<ItemField, V extends DataView<AnyRecord>> =
  NonNullish<ItemField> extends Array<unknown>
    ? WithNullish<ItemField, Array<RawDataViewResult<V>>>
    : WithNullish<ItemField, RawDataViewResult<V>>;

type ViewFieldConfig<V extends DataView<AnyRecord>> = V extends {
  readonly [dataViewFieldsKey]: infer Fields;
}
  ? Fields
  : V['fields'];

type RawFieldResult<
  Item extends AnyRecord,
  Key extends PropertyKey,
  Field extends DataField<Item>,
> = Field extends true
  ? Key extends keyof Item
    ? Item[Key]
    : never
  : Field extends DataView<infer ChildItem>
    ? Key extends keyof Item
      ? RelationResult<Item[Key], DataView<ChildItem>>
      : never
    : Field extends ComputedField<Item, any, any, any>
      ? ComputedResult<Field>
      : Field extends ResolverField<Item, any, any>
        ? ResolverResult<Field>
        : never;

type RawDataViewResult<V extends DataView<AnyRecord>> =
  V extends DataView<infer Item>
    ? {
        [K in keyof ViewFieldConfig<V>]: RawFieldResult<Item, K, ViewFieldConfig<V>[K]>;
      }
    : never;

type DataViewResult<V extends DataView<AnyRecord>> = Serializable<RawDataViewResult<V>>;

type WithTypename<T, Name extends string> = T & { __typename: Name };

/**
 * Resolved entity type from a data view for client use.
 */
export type Entity<
  TView extends DataView<AnyRecord>,
  Name extends string,
  Replacements extends Record<string, unknown> = Record<never, never>,
> = WithTypename<Omit<DataViewResult<TView>, keyof Replacements> & Replacements, Name>;

type SelectedViewNode<Context> = {
  args?: AnyRecord;
  computeds: Map<string, ComputedField<AnyRecord, any, Context>>;
  path: string | null;
  relations: Map<string, SelectedViewNode<Context>>;
  resolvers: Map<string, ResolverField<AnyRecord, any, Context>>;
  selectedFields: Set<string>;
  view: DataView<AnyRecord>;
};

export type ViewPlanNode<Context = unknown> = SelectedViewNode<Context>;

export type ViewPlan<Item extends AnyRecord = AnyRecord, Context = unknown> = {
  args?: AnyRecord;
  ctx?: Context;
  resolve: (item: Item) => Promise<AnyRecord>;
  resolveMany: (items: Array<AnyRecord>) => Promise<Array<AnyRecord>>;
  root: ViewPlanNode<Context>;
  selectedPaths: ReadonlySet<string>;
  view: DataView<Item>;
};

const isResolverField = <Item extends AnyRecord, Context>(
  field: DataField<Item>,
): field is ResolverField<Item, unknown, Context> =>
  Boolean(field) && typeof field === 'object' && 'kind' in field && field.kind === 'resolver';

const isComputedField = <Item extends AnyRecord, Context>(
  field: DataField<Item>,
): field is ComputedField<Item, unknown, Context> =>
  Boolean(field) && typeof field === 'object' && 'kind' in field && field.kind === 'computed';

const isDataViewField = (field: DataField<AnyRecord>): field is DataView<AnyRecord> =>
  Boolean(field) && typeof field === 'object' && 'fields' in field;

const getValueAtPath = (item: AnyRecord, path: string) => {
  let current: unknown = item;

  for (const segment of path.split('.')) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
};

type ComputedState = Record<string, Record<string, unknown>>;

const getComputedState = (item: AnyRecord): ComputedState | undefined =>
  item[computedStateKey as unknown as keyof typeof item] as ComputedState | undefined;

export const attachComputedState = <Item extends AnyRecord>(
  item: Item,
  field: string,
  deps: Record<string, unknown>,
): Item => {
  const state = getComputedState(item) ?? {};
  state[field] = {
    ...(state[field] ?? {}),
    ...deps,
  };

  Object.defineProperty(item, computedStateKey, {
    configurable: true,
    enumerable: false,
    value: state,
    writable: true,
  });

  return item;
};

const getComputedDeps = (
  item: AnyRecord,
  field: string,
  needs?: Record<string, ComputedNeed>,
): Record<string, unknown> => {
  const attached = getComputedState(item)?.[field] ?? {};
  const deps: Record<string, unknown> = { ...attached };

  if (!needs) {
    return deps;
  }

  for (const [name, need] of Object.entries(needs)) {
    if (deps[name] !== undefined) {
      continue;
    }

    if (need.kind === 'count') {
      deps[name] = getValueAtPath(item, `_count.${need.relation}`) ?? 0;
      continue;
    }

    deps[name] = getValueAtPath(item, need.path);
  }

  return deps;
};

const filterToViewFields = (
  item: unknown,
  view: DataView<AnyRecord>,
  selectedPaths: ReadonlySet<string>,
  prefix: string | null = null,
): AnyRecord => {
  if (!isRecord(item)) {
    return item as AnyRecord;
  }

  const filtered: AnyRecord = {};

  for (const [field, config] of Object.entries(view.fields)) {
    const path = prefix ? `${prefix}.${field}` : field;

    let hasSelection = selectedPaths.has(path);

    if (!hasSelection) {
      for (const selected of selectedPaths) {
        if (selected.startsWith(`${path}.`)) {
          hasSelection = true;
          break;
        }
      }
    }

    if (!hasSelection) {
      continue;
    }

    if (!(field in item)) {
      continue;
    }

    const value = item[field];

    if (isDataViewField(config)) {
      if (isConnectionResult(value)) {
        filtered[field] = {
          ...value,
          items: value.items.map((entry) => ({
            ...entry,
            node: isRecord(entry.node)
              ? (filterToViewFields(entry.node, config, selectedPaths, path) as AnyRecord)
              : (entry.node as AnyRecord),
          })),
        } satisfies ConnectionResult<AnyRecord>;
        continue;
      }

      if (Array.isArray(value)) {
        filtered[field] = value.map((entry) =>
          isRecord(entry) ? filterToViewFields(entry, config, selectedPaths, path) : entry,
        );
        continue;
      }

      if (isRecord(value)) {
        filtered[field] = filterToViewFields(value, config, selectedPaths, path);
        continue;
      }
    }

    filtered[field] = value;
  }

  return filtered;
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
  view: DataView<AnyRecord>,
  path: string | null,
  args?: AnyRecord,
): SelectedViewNode<Context> => ({
  args: path ? getScopedArgs(args, path) : args,
  computeds: new Map(),
  path,
  relations: new Map(),
  resolvers: new Map(),
  selectedFields: new Set(),
  view,
});

const assignPath = <Context>(
  node: SelectedViewNode<Context>,
  segments: Array<string>,
  path: string | null,
  args: AnyRecord | undefined,
  selectedPaths: Set<string>,
  view: DataView<AnyRecord>,
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
      selectedPaths.add(nextPath);
    }
    return;
  }

  if (isComputedField(field)) {
    if (rest.length === 0) {
      node.computeds.set(segment, field);
      selectedPaths.add(nextPath);
    }
    return;
  }

  if (isDataViewField(field)) {
    let relationNode = node.relations.get(segment);
    if (!relationNode) {
      relationNode = createSelectedNode(field, nextPath, args);
      node.relations.set(segment, relationNode);
    }

    if (field.fields.id === true) {
      relationNode.selectedFields.add('id');
      selectedPaths.add(`${nextPath}.id`);
    }

    if (rest.length === 0) {
      selectedPaths.add(nextPath);
      return;
    }

    assignPath(relationNode, rest, nextPath, args, selectedPaths, field);
    return;
  }

  if (rest.length === 0) {
    node.selectedFields.add(segment);
    selectedPaths.add(nextPath);
  }
};

const resolveNode = async <Item extends AnyRecord, Context>({
  item,
  node,
  options: resolverOptions,
}: ResolveOptions<Item, Context>): Promise<Item> => {
  if (!isRecord(item)) {
    return item;
  }

  let result: AnyRecord | null = null;

  const assign = (key: string, value: unknown) => {
    if (!result) {
      result = { ...item };
      const state = getComputedState(item);
      if (state) {
        Object.defineProperty(result, computedStateKey, {
          configurable: true,
          enumerable: false,
          value: state,
          writable: true,
        });
      }
    }
    result[key] = value;
  };

  const getItem = () => result ?? item;

  for (const [field, resolver] of node.resolvers) {
    if (resolver.authorize) {
      const authorized = await resolver.authorize(
        getItem(),
        resolverOptions.context,
        resolverOptions.args,
      );

      if (!authorized) {
        assign(field, null);
        continue;
      }
    }

    const value = await resolver.resolve(getItem(), resolverOptions.context, resolverOptions.args);

    if (value !== undefined) {
      assign(field, value);
    }
  }

  for (const [field, computedField] of node.computeds) {
    if (computedField.authorize) {
      const authorized = await computedField.authorize(
        getItem(),
        resolverOptions.context,
        resolverOptions.args,
      );

      if (!authorized) {
        assign(field, null);
        continue;
      }
    }

    const value = await computedField.resolve(
      getItem(),
      getComputedDeps(getItem(), field, computedField.needs) as never,
      resolverOptions.context,
      resolverOptions.args,
    );

    if (value !== undefined) {
      assign(field, value);
    }
  }

  for (const [field, relationNode] of node.relations) {
    const current = getItem()[field];

    if (isConnectionResult(current)) {
      const resolvedItems = await Promise.all(
        current.items.map(async (entry) => ({
          ...entry,
          node: await resolveNode({
            item: entry.node as AnyRecord,
            node: relationNode,
            options: resolverOptions,
          }),
        })),
      );

      const changed = resolvedItems.some(
        (value, index) => value.node !== current.items[index]?.node,
      );
      if (changed) {
        assign(field, { ...current, items: resolvedItems });
      }
      continue;
    }

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

  return result ?? item;
};

/**
 * Builds a generic execution plan for a client's selection against a server
 * data view.
 */
export function createViewPlan<Item extends AnyRecord, Context = unknown>({
  args,
  ctx,
  select: initialSelect,
  view,
}: {
  args?: AnyRecord;
  ctx?: Context;
  select: Iterable<string>;
  view: DataView<Item>;
}) {
  const selectedPaths = new Set<string>();
  selectedPaths.add('id');
  const root = createSelectedNode(view, null, args);
  root.selectedFields.add('id');

  for (const path of initialSelect) {
    if (!path) {
      continue;
    }

    assignPath(root, path.split('.'), null, args, selectedPaths, view);
  }

  const resolve = async (item: Item): Promise<AnyRecord> =>
    toConnectionResult({
      args,
      item: filterToViewFields(
        await resolveNode({
          item,
          node: root,
          options: { args, context: ctx },
        }),
        root.view,
        selectedPaths,
      ),
      view: root.view,
    });

  return {
    args,
    ctx,
    resolve,
    resolveMany: (items: Array<AnyRecord>): Promise<Array<AnyRecord>> =>
      Promise.all(items.map((item) => resolve(item as Item))),
    root,
    selectedPaths,
    view,
  } satisfies ViewPlan<Item, Context>;
}

/**
 * Builds a resolver that applies a client's selection to a server data view,
 * filtering fields, running nested resolvers, and shaping Prisma selects.
 */
export function createResolver<Item extends AnyRecord, Context = unknown>({
  args,
  ctx,
  select,
  view,
}: {
  args?: AnyRecord;
  ctx?: Context;
  select: Iterable<string>;
  view: DataView<Item>;
}) {
  const plan = createViewPlan({ args, ctx, select, view });

  return {
    resolve: plan.resolve,
    resolveMany: plan.resolveMany,
    select: toPrismaSelect(plan),
  };
}
