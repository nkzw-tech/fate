import type {
  ComputedField,
  ComputedSelection,
  DataField,
  DataView,
  ResolverField,
} from '../data-view.ts';
import { isRecord } from '../record.ts';
import { AnyRecord } from '../types.ts';
import { isConnectionResult, toConnectionResult, type ConnectionResult } from './connection.ts';
import { toPrismaSelect } from './prismaSelect.ts';
import { getScopedArgs } from './queryArgs.ts';
export * from '../data-view.ts';

const computedStateKey = Symbol('__fate__ComputedState');

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

const readPath = (value: unknown, segments: ReadonlyArray<string>): unknown => {
  const [name, ...tail] = segments;
  if (name === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => readPath(entry, segments));
  }
  return isRecord(value) ? readPath(value[name], tail) : undefined;
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
  select?: Record<string, ComputedSelection>,
): Record<string, unknown> => {
  const attached = getComputedState(item)?.[field] ?? {};
  const deps: Record<string, unknown> = { ...attached };

  if (!select) {
    return deps;
  }

  for (const [name, selection] of Object.entries(select)) {
    if (deps[name] !== undefined) {
      continue;
    }

    if (selection.kind === 'count') {
      deps[name] = readPath(item, `_count.${selection.relation}`.split('.')) ?? 0;
      continue;
    }

    deps[name] = readPath(item, selection.path.split('.'));
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
      getComputedDeps(getItem(), field, computedField.select) as never,
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
  nestedCursorApplied,
  select: initialSelect,
  view,
}: {
  args?: AnyRecord;
  ctx?: Context;
  nestedCursorApplied?: boolean;
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
      cursorApplied: nestedCursorApplied,
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
