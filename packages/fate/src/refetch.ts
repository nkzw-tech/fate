import { schemaField } from './alias.ts';
import { cloneArgs } from './args.ts';
import { isRecord } from './record.ts';
import type { AnyRecord, TypeConfig } from './types.ts';

type JSONValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JSONValue>
  | { readonly [key: string]: JSONValue };

export type RefetchArgument =
  | Readonly<{ field: string }>
  | Readonly<{ value: JSONValue }>
  | Readonly<{ object: Readonly<Record<string, RefetchArgument>> }>;

/** A query that retrieves one entity without changing its cache identity. */
export type RefetchConfig = Readonly<{
  args: Readonly<Record<string, RefetchArgument>>;
  root: string;
}>;

/** Type-check projections and constants against a query's generated argument contract. */
export type RefetchArguments<Entity, Args> = {
  readonly [K in keyof Args]:
    | Readonly<{
        field: { [F in keyof Entity]-?: Entity[F] extends Args[K] ? F : never }[keyof Entity] &
          string;
      }>
    | Readonly<{ value: Exclude<Args[K], undefined> }>
    | (NonNullable<Args[K]> extends Record<string, unknown>
        ? Readonly<{ object: RefetchArguments<Entity, NonNullable<Args[K]>> }>
        : never);
};

const validateRefetchConstant = (item: unknown): void => {
  if (
    item === null ||
    typeof item === 'string' ||
    typeof item === 'boolean' ||
    (typeof item === 'number' && Number.isFinite(item))
  ) {
    return;
  }
  if (
    Array.isArray(item) ||
    (isRecord(item) && [Object.prototype, null].includes(Object.getPrototypeOf(item)))
  ) {
    for (const child of Object.values(item)) {
      validateRefetchConstant(child);
    }
    return;
  }
  throw new Error('fate: Refetch constants must be JSON values.');
};

const fieldCache = new WeakMap<RefetchConfig, ReadonlySet<string>>();

export const getRefetchFields = (config: RefetchConfig | undefined): ReadonlySet<string> => {
  if (!config) {
    return emptyFields;
  }
  const cached = fieldCache.get(config);
  if (cached) {
    return cached;
  }
  if (typeof config.root !== 'string' || !config.root.length || !isRecord(config.args)) {
    throw new Error('fate: Invalid entity refetch configuration.');
  }
  const fields = new Set<string>();
  const walk = (value: RefetchArgument) => {
    if (!isRecord(value)) {
      throw new Error(
        'fate: Refetch arguments must be field projections, constants, or input objects.',
      );
    }
    if ('field' in value && typeof value.field === 'string') {
      if (Object.keys(value).length !== 1 || !/^[_A-Za-z][_0-9A-Za-z]*$/.test(value.field)) {
        throw new Error('fate: Invalid refetch field projection.');
      }
      fields.add(value.field);
    } else if ('value' in value) {
      if (Object.keys(value).length !== 1) {
        throw new Error('fate: Invalid refetch constant.');
      }
      const constant = (value as { value: unknown }).value;
      validateRefetchConstant(constant);
    } else if ('object' in value && isRecord(value.object) && Object.keys(value).length === 1) {
      Object.values(value.object).forEach(walk);
    } else {
      throw new Error('fate: Invalid refetch input object. Use { object: { ... } }.');
    }
  };
  Object.values(config.args).forEach(walk);
  fieldCache.set(config, fields);
  return fields;
};

const emptyFields: ReadonlySet<string> = new Set();

export const resolveRefetchArgs = (
  config: RefetchConfig,
  record: AnyRecord | undefined,
  type: string,
): AnyRecord => {
  const resolve = (value: RefetchArgument): unknown => {
    if ('field' in value) {
      if (!record || !Object.hasOwn(record, value.field) || record[value.field] === undefined) {
        throw new Error(
          `fate: Cannot refetch '${type}': missing confirmed locator field '${value.field}'. Fetch the entity through a root query first.`,
        );
      }
      return record[value.field];
    }
    if ('value' in value) {
      return value.value;
    }
    return Object.fromEntries(
      Object.entries(value.object).map(([key, child]) => [key, resolve(child)]),
    );
  };
  return cloneArgs(
    Object.fromEntries(Object.entries(config.args).map(([key, value]) => [key, resolve(value)])),
    'refetch',
  );
};

const clientsWithRefetch = new WeakMap<ReadonlyMap<string, TypeConfig>, boolean>();

/** Add each selected entity's locator fields without changing the component's view. */
export const expandRefetchSelection = (
  types: ReadonlyMap<string, TypeConfig>,
  type: string,
  select: Iterable<string>,
): Iterable<string> => {
  let active = clientsWithRefetch.get(types);
  if (active === undefined) {
    active = [...types.values()].some((config) => config.refetch);
    clientsWithRefetch.set(types, active);
  }
  if (!active) {
    return select;
  }
  const selected = [...select];
  const paths = new Set(selected);
  const visited = new Set<string>();
  const addFields = (name: string, prefix: string) => {
    if (visited.has(prefix)) {
      return;
    }
    visited.add(prefix);
    for (const field of getRefetchFields(types.get(name)?.refetch)) {
      paths.add(`${prefix}${field}`);
    }
  };
  addFields(type, '');
  for (const path of selected) {
    let current = type;
    let prefix = '';
    for (const segment of path.split('.')) {
      const relation = types.get(current)?.fields?.[schemaField(segment)];
      if (!relation || relation === 'scalar') {
        break;
      }
      current =
        'type' in relation
          ? relation.type
          : 'listOf' in relation
            ? relation.listOf
            : relation.embedded;
      prefix += `${segment}.`;
      addFields(current, prefix);
    }
  }
  return paths;
};

/** GraphQL node IDs are encoded only for automatic refetches, never ordinary root inputs. */
export const encodeRefetchArgs = (
  recipe: RefetchConfig,
  args: AnyRecord,
  encodeId: (id: string | number) => string | number,
): AnyRecord => {
  const encode = (
    definitions: Readonly<Record<string, RefetchArgument>>,
    values: AnyRecord,
  ): AnyRecord => ({
    ...values,
    ...Object.fromEntries(
      Object.entries(definitions).map(([key, definition]) => {
        const value = values[key];
        return [
          key,
          'field' in definition &&
          definition.field === 'id' &&
          (typeof value === 'string' || typeof value === 'number')
            ? encodeId(value)
            : 'object' in definition && isRecord(value)
              ? encode(definition.object, value)
              : value,
        ];
      }),
    ),
  });
  return encode(recipe.args, args);
};
