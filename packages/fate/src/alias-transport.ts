import { schemaField } from './alias.ts';
import { isRecord } from './record.ts';
import type { Transport } from './transport.ts';
import type { AnyRecord, MutationShape } from './types.ts';

type Tree = Map<string, Tree>;
type Group = { paths: Set<string>; sources: Map<string, string>; tree: Tree };

const groupsFor = (select: Iterable<string>): Array<Group> => {
  const groups: Array<Group> = [];
  for (const path of select) {
    const parts = path.split('.');
    const sources = parts.map(
      (_, index) =>
        [
          parts
            .slice(0, index + 1)
            .map(schemaField)
            .join('.'),
          parts.slice(0, index + 1).join('.'),
        ] as const,
    );
    let group = groups.find(({ sources: current }) =>
      sources.every(([key, value]) => !current.has(key) || current.get(key) === value),
    );
    if (!group) {
      group = { paths: new Set(), sources: new Map(), tree: new Map() };
      groups.push(group);
    }
    for (const [key, value] of sources) {
      group.sources.set(key, value);
    }
    group.paths.add(parts.map(schemaField).join('.'));
    let tree = group.tree;
    for (const part of parts) {
      let child = tree.get(part);
      if (!child) {
        child = new Map();
        tree.set(part, child);
      }
      tree = child;
    }
  }
  return groups;
};

const project = (value: unknown, tree: Tree): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => project(item, tree));
  }
  if (!isRecord(value)) {
    return value;
  }
  if (Array.isArray(value.items)) {
    return {
      ...value,
      items: value.items.map((entry) =>
        isRecord(entry) ? { ...entry, node: project(entry.node, tree) } : entry,
      ),
    };
  }
  const result = { ...value };
  for (const field of tree.keys()) {
    if (field.includes(':')) {
      delete result[schemaField(field)];
    }
  }
  for (const [field, child] of tree) {
    if (Object.hasOwn(value, schemaField(field))) {
      result[field] = project(value[schemaField(field)], child);
    }
  }
  return result;
};

const scopedArgs = (args: AnyRecord | undefined, group: Group): AnyRecord | undefined => {
  if (!args) {
    return undefined;
  }
  const walk = (value: AnyRecord, prefix: string): AnyRecord =>
    Object.fromEntries(
      Object.entries(value).flatMap(([key, child]) => {
        const sourcePath = prefix ? `${prefix}.${schemaField(key)}` : schemaField(key);
        const selected = group.sources.get(sourcePath);
        if ((selected || key.includes(':')) && selected?.split('.').at(-1) !== key) {
          return [];
        }
        return [[schemaField(key), selected && isRecord(child) ? walk(child, sourcePath) : child]];
      }),
    );
  return walk(args, '');
};

const merge = (left: unknown, right: unknown): unknown => {
  if (Array.isArray(left) && Array.isArray(right)) {
    const rightById = new Map<unknown, unknown>();
    for (const entry of right) {
      if (isRecord(entry) && entry.id !== undefined && !rightById.has(entry.id)) {
        rightById.set(entry.id, entry);
      }
    }
    return left.map((item, index) => {
      const match = isRecord(item) && item.id !== undefined ? rightById.get(item.id) : right[index];
      return match === undefined ? item : merge(item, match);
    });
  }
  if (isRecord(left) && isRecord(right)) {
    const result = { ...left };
    for (const [key, value] of Object.entries(right)) {
      result[key] = Object.hasOwn(left, key) ? merge(left[key], value) : value;
    }
    return result;
  }
  return right;
};

const readAliases = (
  select: Iterable<string>,
  args: AnyRecord | undefined,
  fetch: (select: Set<string>, args?: AnyRecord) => Promise<unknown>,
) => {
  const paths = new Set(select);
  if (![...paths].some((path) => path.includes(':'))) {
    return fetch(paths, args);
  }
  const groups = groupsFor(paths);
  return Promise.all(
    groups.map(async (group) =>
      project(await fetch(group.paths, scopedArgs(args, group)), group.tree),
    ),
  ).then((values) => values.reduce(merge));
};

/** Lower read aliases for existing native/custom transports without changing their protocol. */
export const withAliasSupport = <M extends Record<string, MutationShape>>(
  transport: Transport<M>,
): Transport<M> => {
  if (transport.supportsAliases) {
    return transport;
  }
  const mutation = (
    select: Set<string>,
    input: unknown,
    selectionArgs: AnyRecord | undefined,
    execute: (select: Set<string>, input: unknown, selectionArgs?: AnyRecord) => Promise<unknown>,
  ) => {
    if (![...select].some((path) => path.includes(':'))) {
      return execute(select, input, selectionArgs);
    }
    const groups = groupsFor(select);
    if (groups.length > 1) {
      return Promise.reject(
        new Error('fate: This mutation selection requires a transport with native alias support.'),
      );
    }
    const group = groups[0];
    const nextInput =
      !transport.separateMutationSelectionArgs && isRecord(input) && isRecord(input.args)
        ? { ...input, args: scopedArgs(input.args, group) }
        : input;
    return execute(
      group.paths,
      nextInput,
      transport.separateMutationSelectionArgs ? scopedArgs(selectionArgs, group) : selectionArgs,
    ).then((value) => project(value, group.tree));
  };
  return {
    ...transport,
    fetchById: (type, ids, select, args, context) =>
      readAliases(select, args, (fields, scoped) =>
        context
          ? transport.fetchById(type, ids, fields, scoped, context)
          : transport.fetchById(type, ids, fields, scoped),
      ) as ReturnType<Transport<M>['fetchById']>,
    fetchList: transport.fetchList
      ? (name, select, args, context) =>
          readAliases(select, args, (fields, scoped) =>
            context
              ? transport.fetchList!(name, fields, scoped, context)
              : transport.fetchList!(name, fields, scoped),
          ) as ReturnType<NonNullable<Transport<M>['fetchList']>>
      : undefined,
    fetchQuery: transport.fetchQuery
      ? (name, select, args, context) =>
          readAliases(select, args, (fields, scoped) =>
            context
              ? transport.fetchQuery!(name, fields, scoped, context)
              : transport.fetchQuery!(name, fields, scoped),
          )
      : undefined,
    mutate: transport.mutate
      ? (name, input, select, selectionArgs) =>
          mutation(select, input, selectionArgs, (fields, nextInput, nextSelectionArgs) =>
            transport.separateMutationSelectionArgs
              ? transport.mutate!(name, nextInput as never, fields, nextSelectionArgs)
              : transport.mutate!(name, nextInput as never, fields),
          ) as never
      : undefined,
    mutateDurably: transport.mutateDurably
      ? (name, input, select, identity, selectionArgs) =>
          mutation(select, input, selectionArgs, (fields, nextInput, nextSelectionArgs) =>
            transport.separateMutationSelectionArgs
              ? transport.mutateDurably!(
                  name,
                  nextInput as never,
                  fields,
                  identity,
                  nextSelectionArgs,
                )
              : transport.mutateDurably!(name, nextInput as never, fields, identity),
          ) as never
      : undefined,
    subscribeById: transport.subscribeById
      ? (type, id, select, args, handlers) => {
          const paths = new Set(select);
          if (![...paths].some((path) => path.includes(':'))) {
            return transport.subscribeById!(type, id, paths, args, handlers);
          }
          const disposers = groupsFor(paths).map((group) =>
            transport.subscribeById!(type, id, group.paths, scopedArgs(args, group), {
              ...handlers,
              onData: (record, selected) =>
                handlers.onData(
                  project(record, group.tree),
                  selected?.flatMap((path) => {
                    const original = group.sources.get(path);
                    return original ? [original] : [];
                  }),
                ),
            }),
          );
          return () => disposers.forEach((dispose) => dispose());
        }
      : undefined,
    subscribeConnection: transport.subscribeConnection
      ? (procedure, type, args, select, selectionArgs, handlers) => {
          const paths = new Set(select);
          if (![...paths].some((path) => path.includes(':'))) {
            return transport.subscribeConnection!(
              procedure,
              type,
              args,
              paths,
              selectionArgs,
              handlers,
            );
          }
          const disposers = groupsFor(paths).map((group) =>
            transport.subscribeConnection!(
              procedure,
              type,
              args,
              group.paths,
              scopedArgs(selectionArgs, group),
              {
                ...handlers,
                onEvent: (event) =>
                  handlers.onEvent(
                    'edge' in event
                      ? {
                          ...event,
                          edge: { ...event.edge, node: project(event.edge.node, group.tree) },
                        }
                      : event,
                  ),
              },
            ),
          );
          return () => disposers.forEach((dispose) => dispose());
        }
      : undefined,
  };
};
