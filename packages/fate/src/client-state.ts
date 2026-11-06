import { responseField, schemaField, typeBranchField, typeCondition } from './alias.ts';
import type { ClientStateReference } from './client-persistence.ts';
import type {
  ClientMutationDefinition,
  ClientSchema,
  ClientTypeDefinition,
} from './client-schema.ts';
import type { FateClient } from './client.ts';
import type { ComputedField } from './data-view.ts';
import { getFieldKey } from './field-key.ts';
import type { MutationOptions } from './mutation.ts';
import { createNodeRef, getNodeRefId, isNodeRef } from './node-ref.ts';
import { normalizationInput } from './normalization-input.ts';
import { isDate, isRecord } from './record.ts';
import { parseEntityId, toEntityId } from './ref.ts';
import type { SelectionPlan } from './selection.ts';
import type { AnyRecord, EntityId, RelationDescriptor, TypeConfig } from './types.ts';

export const recordPaths = (record: AnyRecord, prefix = ''): Set<string> => {
  const paths = new Set<string>();
  for (const [key, value] of Object.entries(record)) {
    const path = `${prefix}${key}`;
    paths.add(path);
    if (isRecord(value) && !isNodeRef(value)) {
      for (const nested of recordPaths(value, `${path}.`)) {
        paths.add(nested);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isRecord(item) && !isNodeRef(item)) {
          for (const nested of recordPaths(item, `${path}.`)) {
            paths.add(nested);
          }
        }
      }
    }
  }
  return paths;
};

const relationType = (field?: RelationDescriptor) =>
  !field || field === 'scalar'
    ? undefined
    : 'type' in field
      ? field.type
      : 'listOf' in field
        ? field.listOf
        : undefined;

const isComputed = (field: unknown): field is ComputedField<any, any, any, any> =>
  isRecord(field) && field.kind === 'computed';

// Dependencies have no arguments. Alias them when a view selects the same path with arguments.
const dependencyPath = (path: string, plan: SelectionPlan | undefined, prefix: string): string =>
  path
    .split('.')
    .map((field) => {
      const parent = prefix ? `${prefix}.` : '';
      if (plan?.args.has(`${parent}${field}`)) {
        const names = new Set(
          [...plan.paths]
            .filter((path) => path.startsWith(parent))
            .map((path) => responseField(path.slice(parent.length).split('.')[0])),
        );
        const base = `fate_dependency_${responseField(field)}`;
        let name = base;
        let index = 0;
        while (names.has(name)) {
          name = `${base}_${++index}`;
        }
        const condition = typeCondition(field);
        field = `${name}:${schemaField(field)}${condition ? `:${condition}` : ''}`;
      }
      prefix = `${parent}${field}`;
      return field;
    })
    .join('.');

export default class ClientState {
  readonly initialRecords = new WeakSet<AnyRecord>();
  readonly initialIds = new Set<EntityId>();
  readonly definitions = new Map<string, ClientTypeDefinition>();
  readonly localTypes = new Set<string>();
  readonly roots = new Map<string, { id: string | number; type: string }>();
  readonly mutations = new Map<string, ClientMutationDefinition>();
  savedRecords: ReadonlyMap<EntityId, AnyRecord | null> = new Map();
  savedReferences: ReadonlyMap<EntityId, ClientStateReference | null> = new Map();
  private readonly computedCache = new Map<string, { result: unknown; values: Array<unknown> }>();

  constructor(private readonly client: FateClient<any, any, any>) {}

  install(schema: ClientSchema, types: Map<string, TypeConfig>) {
    for (const [name, definition] of Object.entries({
      ...schema.types,
      ...schema.typeExtensions,
    })) {
      if (this.definitions.has(name)) {
        throw new Error(`fate: Client type '${name}' is already registered.`);
      }
      if (definition.view.typeName !== name) {
        throw new Error(`fate: Client type '${name}' must use a matching data view.`);
      }
      const existing = types.get(name);
      if (schema.types?.[name] && existing) {
        throw new Error(`fate: Type '${name}' already exists. Use 'typeExtensions'.`);
      }
      if (schema.typeExtensions?.[name] && !existing) {
        throw new Error(`fate: Cannot extend unknown type '${name}'.`);
      }
      if (schema.types?.[name]) {
        this.localTypes.add(name);
      }
      const fields = { ...existing?.fields };
      for (const [key, field] of Object.entries(definition.view.fields)) {
        if (
          schema.typeExtensions?.[name] &&
          (key === 'id' || key === '__typename' || existing?.fields?.[key])
        ) {
          throw new Error(`fate: Client field '${name}.${key}' conflicts with a server field.`);
        }
        if (isComputed(field) && field.authorize) {
          throw new Error(
            `fate: Client computed field '${name}.${key}' cannot use server authorization.`,
          );
        }
        if (field === true || isComputed(field)) {
          fields[key] = 'scalar';
        } else if (isRecord(field) && 'typeName' in field) {
          fields[key] =
            field.kind === 'list'
              ? { array: true, listOf: String(field.typeName) }
              : { type: String(field.typeName) };
        } else {
          throw new Error(
            `fate: Client field '${name}.${key}' must be stored data, a relationship, or a synchronous computed field.`,
          );
        }
      }
      types.set(name, {
        getId: (value) => (value as { id: string | number }).id,
        ...existing,
        fields,
        type: name,
      });
      this.definitions.set(name, definition);
    }
    for (const [name, root] of Object.entries(schema.roots ?? {})) {
      if (!this.localTypes.has(root.type)) {
        throw new Error(`fate: Local root '${name}' must refer to a client type.`);
      }
      this.roots.set(name, root);
    }
    // Validate computation graphs before any component reads them.
    for (const [type, definition] of this.definitions) {
      this.expand(type, Object.keys(definition.view.fields));
    }
  }

  isComputed(type: string, field: string) {
    return isComputed(this.definitions.get(type)?.view.fields[field]);
  }

  isLocalField(type: string, field: string): boolean {
    return this.localTypes.has(type) || Boolean(this.definitions.get(type)?.view.fields[field]);
  }

  initial(type: string, id: string | number): AnyRecord {
    const definition = this.definitions.get(type)!;
    const initial = definition.defaults(id);
    for (const key of Object.keys(initial)) {
      if (
        key !== 'id' &&
        key !== '__typename' &&
        (!definition.view.fields[key] || this.isComputed(type, key))
      ) {
        throw new Error(`fate: Initializer '${type}.${key}' is not a stored client field.`);
      }
    }
    return initial;
  }

  defaults(type: string, id: string | number, incoming: AnyRecord): AnyRecord | undefined {
    const definition = this.definitions.get(type);
    if (!definition) {
      return;
    }
    const existing = this.client.store.read(toEntityId(type, id));
    const missing = Object.entries(definition.view.fields).filter(
      ([key, value]) =>
        !isComputed(value) && !Object.hasOwn(incoming, key) && !Object.hasOwn(existing ?? {}, key),
    );
    if (!missing.length) {
      return;
    }
    const saved = this.savedRecords.get(toEntityId(type, id));
    let initial: AnyRecord | undefined;
    const result: AnyRecord = {};
    for (const [key] of missing) {
      if (saved && Object.hasOwn(saved, key)) {
        result[key] = saved[key];
        continue;
      }
      initial ??= this.initial(type, id);
      if (!Object.hasOwn(initial, key)) {
        throw new Error(`fate: Missing initializer for client field '${type}.${key}'.`);
      }
      result[key] = initial[key];
    }
    return result;
  }

  expand(
    type: string,
    paths: Iterable<string>,
    remote = false,
    plan?: SelectionPlan,
    prefix = '',
    visiting = new Set<string>(),
  ): Set<string> {
    const result = new Set<string>();
    for (const path of paths) {
      const [segment, ...tail] = path.split('.');
      const condition = typeCondition(segment);
      const current = condition ?? type;
      const name = schemaField(segment);
      const definition = this.definitions.get(current)?.view.fields[name];
      if (isComputed(definition)) {
        const key = `${current}.${name}`;
        if (visiting.has(key)) {
          throw new Error(`fate: Cyclic client computation at '${key}'.`);
        }
        const next = new Set(visiting).add(key);
        const deps = Object.values(definition.select ?? {}).map((dependency: any) => {
          if (dependency.kind === 'field') {
            return dependency.path as string;
          }
          if (dependency.kind === 'count' && !dependency.where) {
            return `${dependency.relation}.id`;
          }
          throw new Error(`fate: Unsupported client dependency on '${key}'.`);
        });
        for (const dependency of this.expand(current, deps, remote, undefined, '', next)) {
          const [field, ...tail] = dependency.split('.');
          result.add(
            dependencyPath(
              condition ? [typeBranchField(condition, field), ...tail].join('.') : dependency,
              plan,
              prefix,
            ),
          );
        }
        continue;
      }
      if (remote && this.isLocalField(current, name)) {
        continue;
      }
      const child = relationType(this.client.getTypeConfig(current).fields?.[name]);
      if (tail.length && child) {
        const nested = this.expand(
          child,
          [tail.join('.')],
          remote,
          plan,
          prefix ? `${prefix}.${segment}` : segment,
          visiting,
        );
        for (const field of nested) {
          result.add(`${segment}.${field}`);
        }
        if (remote && nested.size === 0) {
          result.add(`${segment}.id`);
        }
      } else {
        result.add(path);
      }
    }
    return result;
  }

  remoteSelection(type: string, paths: Iterable<string>, plan?: SelectionPlan): Iterable<string> {
    if (!this.definitions.size || type === '__value__') {
      return paths;
    }
    const result = this.expand(type, paths, true, plan);
    if (!result.size && !this.localTypes.has(type)) {
      result.add('id');
    }
    return result;
  }

  remoteArgs(
    type: string,
    args?: AnyRecord,
    paths?: ReadonlySet<string>,
    prefix = '',
  ): AnyRecord | undefined {
    if (!args || !this.definitions.size || type === '__value__') {
      return args;
    }
    const result: AnyRecord = {};
    for (const [key, value] of Object.entries(args)) {
      const current = typeCondition(key) ?? type;
      const name = schemaField(key);
      const path = `${prefix}${key}`;
      if (
        this.isLocalField(current, name) &&
        (!paths || [...paths].some((field) => field === path || field.startsWith(`${path}.`)))
      ) {
        continue;
      }
      const child = relationType(this.client.getTypeConfig(current).fields?.[name]);
      result[key] =
        child && isRecord(value) ? this.remoteArgs(child, value, paths, `${path}.`) : value;
    }
    return Object.keys(result).length ? result : undefined;
  }

  sanitize(type: string, value: unknown): any {
    if (!this.definitions.size || !isRecord(value) || isNodeRef(value)) {
      return value;
    }
    const input = normalizationInput(value);
    if (input) {
      value = input.materialize(value);
    }
    const record = value as AnyRecord;
    type = typeof record.__typename === 'string' ? record.__typename : type;
    if (type === '__value__') {
      return record;
    }
    const result: AnyRecord = {};
    for (const [key, entry] of Object.entries(record)) {
      const name = schemaField(key);
      if (this.isLocalField(type, name) && name !== 'id' && name !== '__typename') {
        continue;
      }
      const child = relationType(this.client.getTypeConfig(type).fields?.[name]);
      result[key] = child
        ? Array.isArray(entry)
          ? entry.map((item) => this.sanitize(child, item))
          : isRecord(entry) && Array.isArray(entry.items)
            ? {
                ...entry,
                items: entry.items.map((item: any) => ({
                  ...item,
                  node: this.sanitize(child, item.node),
                })),
              }
            : this.sanitize(child, entry)
        : entry;
    }
    return result;
  }

  readField(
    id: EntityId,
    field: string,
    plan: SelectionPlan,
    path: string,
    coverage: Map<EntityId, Set<string>>,
    stack = new Set<string>(),
  ): unknown {
    const { type } = parseEntityId(id);
    const key = getFieldKey(path, plan);
    coverage.set(id, (coverage.get(id) ?? new Set()).add(key));
    const definition = this.definitions.get(type)?.view.fields[field];
    if (!isComputed(definition)) {
      return this.client.store.read(id)?.[key];
    }
    const cacheKey = `${id}:${key}`;
    if (stack.has(cacheKey)) {
      throw new Error(`fate: Cyclic client computation at '${type}.${field}'.`);
    }
    stack = new Set(stack).add(cacheKey);
    const values: Array<unknown> = [];
    const read = (owner: EntityId, segments: Array<string>): unknown => {
      const [name, ...tail] = segments;
      const value = this.readField(
        owner,
        name,
        { ...plan, args: new Map() },
        name,
        coverage,
        stack,
      );
      return readValue(value, tail);
    };
    const readValue = (value: unknown, segments: Array<string>): unknown => {
      if (!segments.length || value == null) {
        return value;
      }
      if (isNodeRef(value)) {
        return read(getNodeRefId(value), segments);
      }
      if (Array.isArray(value)) {
        return value.map((item) => readValue(item, segments));
      }
      const [name, ...tail] = segments;
      return isRecord(value) ? readValue(value[name], tail) : undefined;
    };
    const deps: AnyRecord = {};
    for (const [name, dependency] of Object.entries(definition.select ?? {}) as Array<
      [string, any]
    >) {
      const value = read(
        id,
        (dependency.kind === 'field' ? dependency.path : dependency.relation).split('.'),
      );
      deps[name] = dependency.kind === 'count' ? (Array.isArray(value) ? value.length : 0) : value;
      if (Array.isArray(deps[name])) {
        values.push((deps[name] as Array<unknown>).length, ...(deps[name] as Array<unknown>));
      } else {
        values.push(deps[name]);
      }
    }
    const args = plan.args.get(path)?.value;
    values.push(args);
    const previous = this.computedCache.get(cacheKey);
    if (
      previous &&
      previous.values.length === values.length &&
      values.every((value, index) => Object.is(value, previous.values[index]))
    ) {
      return previous.result;
    }
    const result = definition.resolve(
      Object.freeze({ ...deps }),
      Object.freeze(deps),
      undefined,
      args,
    );
    if (result && typeof result === 'object' && 'then' in result) {
      throw new Error(`fate: Client computed field '${type}.${field}' must be synchronous.`);
    }
    this.computedCache.set(cacheKey, { result, values });
    return result;
  }

  collect(id: EntityId) {
    for (const key of this.computedCache.keys()) {
      if (key.startsWith(`${id}:`)) {
        this.computedCache.delete(key);
      }
    }
  }

  prepare(
    key: string,
    input: unknown,
    executeRemoteMutation: (
      key: string,
      input: unknown,
      options?: Pick<MutationOptions<any>, 'args' | 'select' | 'view'>,
    ) => Promise<{ plan?: SelectionPlan; result: unknown }>,
  ) {
    const definition = this.mutations.get(key);
    if (!definition) {
      return;
    }
    const patches = new Map<EntityId, { data: AnyRecord | null }>();
    // Track identities on materialized references: a custom getId can depend on
    // server fields that are absent after restoring a persisted relationship.
    const materializedIds = new WeakMap<AnyRecord, string | number>();
    const writes: Array<{
      data: AnyRecord | null;
      id: EntityId;
      plan?: SelectionPlan;
      prefix?: string;
      remote?: boolean;
    }> = [];
    let active = true;
    const assertActive = () => {
      if (!active) {
        throw new Error('fate: Client mutation context has already settled.');
      }
    };
    // Keep a normalized overlay so a write through one relationship is immediately
    // visible through every other relationship, without publishing partial changes.
    const stage = (
      type: string,
      id: string | number,
      value: AnyRecord,
      remote = false,
      visiting = new WeakSet<AnyRecord>(),
      plan?: SelectionPlan,
      prefix?: string,
    ) => {
      const entityId = toEntityId(type, id);
      const ref = createNodeRef(entityId);
      if (visiting.has(value)) {
        return ref;
      }
      visiting.add(value);
      const previous = patches.get(entityId);
      const existing = this.client.store.readConfirmed(entityId)?.record;
      const initial =
        !previous?.data && !existing && this.definitions.has(type)
          ? { ...this.initial(type, id), ...this.savedRecords.get(entityId) }
          : {};
      const storedId =
        (remote ? value.id : undefined) ??
        previous?.data?.id ??
        existing?.id ??
        (!previous?.data && !existing ? value.id : undefined) ??
        id;
      const data = { ...previous?.data, __typename: type, id: storedId } as AnyRecord;
      patches.set(entityId, { data });
      // Preserve each write's selection while the overlay uses normalized field keys.
      const write: AnyRecord = { __typename: type, id: storedId };
      writes.push({ data: write, id: entityId, plan, prefix, remote });
      const config = this.client.getTypeConfig(type);
      for (const [key, entry] of Object.entries({ ...initial, ...value })) {
        const name = schemaField(key);
        const path = prefix ? `${prefix}.${key}` : key;
        if (
          key === '__typename' ||
          key === 'id' ||
          (!remote && (!this.isLocalField(type, name) || this.isComputed(type, name)))
        ) {
          continue;
        }
        const descriptor = config.fields?.[name];
        const child =
          descriptor && descriptor !== 'scalar'
            ? 'type' in descriptor
              ? descriptor.type
              : 'listOf' in descriptor
                ? descriptor.listOf
                : undefined
            : undefined;
        const normalize = (node: unknown): unknown => {
          if (!isRecord(node) || isNodeRef(node)) {
            return node;
          }
          const concrete = typeof node.__typename === 'string' ? node.__typename : child!;
          const childId =
            materializedIds.get(node) ?? this.client.getTypeConfig(concrete).getId(node) ?? node.id;
          if (typeof childId !== 'string' && typeof childId !== 'number') {
            throw new Error(`fate: A related '${concrete}' record needs an id.`);
          }
          return stage(concrete, childId, node, remote, visiting, plan, path);
        };
        const connection =
          descriptor &&
          descriptor !== 'scalar' &&
          'listOf' in descriptor &&
          isRecord(entry) &&
          Array.isArray(entry.items)
            ? {
                ...entry,
                items: entry.items.map((item: any) => ({ ...item, node: normalize(item.node) })),
              }
            : undefined;
        const normalized = connection
          ? connection.items.map(({ node }) => node)
          : child
            ? Array.isArray(entry)
              ? entry.map(normalize)
              : normalize(entry)
            : entry;
        // Commit needs the page metadata; reads see the normalized list of nodes.
        write[key] = connection ?? normalized;
        data[getFieldKey(path, plan)] = normalized;
      }
      visiting.delete(value);
      return ref;
    };
    const materialize = (value: unknown, seen = new Set<string>()): any => {
      if (isDate(value)) {
        return new Date(value.getTime());
      }
      if (isNodeRef(value)) {
        const id = getNodeRefId(value);
        const staged = patches.get(id);
        if (staged?.data === null) {
          return null;
        }
        const { id: rawId, type } = parseEntityId(id);
        const saved = this.savedReferences.get(id);
        const record = {
          __typename: type,
          id: saved?.id ?? rawId,
          ...saved?.record,
          ...this.client.store.readConfirmed(id)?.record,
          ...staged?.data,
        };
        const result = seen.has(id)
          ? { __typename: type, id: record.id }
          : materialize(record, new Set(seen).add(id));
        materializedIds.set(result, saved?.id ?? rawId);
        return result;
      }
      if (Array.isArray(value)) {
        return value
          .filter((entry) => !isNodeRef(entry) || patches.get(getNodeRefId(entry))?.data !== null)
          .map((entry) => materialize(entry, seen));
      }
      if (isRecord(value)) {
        return Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [key, materialize(entry, seen)]),
        );
      }
      return value;
    };
    const get = (type: string, id: string | number) => {
      assertActive();
      const entityId = toEntityId(type, id);
      const staged = patches.get(entityId);
      if (staged?.data === null) {
        return undefined;
      }
      const existing = this.client.store.readConfirmed(entityId)?.record;
      return existing || staged
        ? materialize({ id, ...existing, ...staged?.data, __typename: type })
        : undefined;
    };
    const update = (type: string, id: string | number, data: AnyRecord, create = false) => {
      assertActive();
      if (!create && !get(type, id)) {
        throw new Error(`fate: Cannot update missing client record '${type}:${id}'.`);
      }
      for (const name of Object.keys(data)) {
        if (name === 'id' || name === '__typename') {
          continue;
        }
        if (
          !this.definitions.get(type)?.view.fields[name] ||
          isComputed(this.definitions.get(type)?.view.fields[name])
        ) {
          throw new Error(`fate: '${type}.${name}' is not a stored client field.`);
        }
      }
      stage(type, id, data);
      return get(type, id);
    };
    const execute = () =>
      definition.resolve({
        input: definition.input ? definition.input.parse(input) : input,
        mutateRemote: async (name, remoteInput, options) => {
          assertActive();
          const { plan, result } = await executeRemoteMutation(name, remoteInput, options);
          assertActive();
          const type = this.client.getMutationEntity(name);
          if (type && type !== '__value__' && isRecord(result)) {
            const concrete = this.client.resolveEntityType(type, result);
            const id = this.client.getTypeConfig(concrete).getId(result);
            stage(concrete, id, result, true, undefined, plan);
          }
          return result as any;
        },
        store: {
          create: (type, data) => {
            if (!this.localTypes.has(type)) {
              throw new Error(`fate: Cannot create server type '${type}' locally.`);
            }
            const id = (data as AnyRecord).id as string | number;
            if (typeof id !== 'string' && typeof id !== 'number') {
              throw new Error('fate: A client record needs an id.');
            }
            if (get(type, id)) {
              throw new Error(`fate: Client record '${type}:${id}' already exists.`);
            }
            return update(type, id, { ...this.initial(type, id), ...(data as AnyRecord) }, true);
          },
          delete: (type, id) => {
            assertActive();
            if (!this.localTypes.has(type)) {
              throw new Error(`fate: Cannot delete server type '${type}' locally.`);
            }
            const entityId = toEntityId(type, id);
            patches.set(entityId, { data: null });
            writes.push({ data: null, id: entityId });
          },
          get,
          update,
        },
      });
    return {
      commit: () => {
        assertActive();
        active = false;
        for (const { data, id: entityId, plan, prefix, remote } of writes) {
          const { id, type } = parseEntityId(entityId);
          if (data === null) {
            this.client.deleteRecord(type, id);
          } else {
            this.client.writeClientRecord(type, id, data, plan, prefix, remote);
          }
        }
        patches.clear();
        writes.length = 0;
      },
      execute,
      rollback: () => {
        active = false;
        patches.clear();
        writes.length = 0;
      },
    };
  }
}
