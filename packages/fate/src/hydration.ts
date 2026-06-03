import { createNodeRef, getNodeRefId, isNodeRef } from './node-ref.ts';
import type { List, StoreHydrationState } from './store.ts';
import type { AnyRecord } from './types.ts';

/** JSON-safe opaque value contained in a dehydrated fate snapshot. */
type FateSerializedValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<FateSerializedValue>
  | Readonly<{ [key: string]: FateSerializedValue }>;

/** Versioned, JSON-safe durable cache snapshot produced by `FateClient.dehydrate()`. */
declare const hydrationScopeBrand: unique symbol;

export type FateDehydratedState<Scope extends string = string> = Readonly<{
  data: FateSerializedValue;
  readonly [hydrationScopeBrand]?: Scope;
  scope: Scope;
  version: 1;
}>;

/** Controls how `FateClient.hydrate()` reconciles a snapshot with browser cache state. */
export type HydrateOptions = Readonly<{
  /**
   * `preserve-existing` keeps browser values and list windows when conflicts
   * occur. `replace` treats the snapshot as authoritative.
   *
   * @defaultValue 'preserve-existing'
   */
  merge?: 'preserve-existing' | 'replace';
}>;

/** Resource limits applied while encoding and decoding hydration snapshots. */
export type HydrationLimits = Readonly<{
  /** Maximum number of entries in any encoded array or object. */
  maxCollectionLength: number;
  /** Maximum number of encoded values in a hydration snapshot. */
  maxNodes: number;
  /** Maximum length of an encoded string, object key, or bigint payload. */
  maxStringLength: number;
}>;

export type ClientHydrationState = Readonly<{
  rootLists: ReadonlyArray<readonly [string, ReadonlyArray<string>]>;
  rootRequests: ReadonlyArray<readonly [string, string | null]>;
  store: StoreHydrationState;
}>;

type EncodedValue = ReadonlyArray<FateSerializedValue>;

const maxDepth = 64;
const defaultHydrationLimits: HydrationLimits = {
  maxCollectionLength: 100_000,
  maxNodes: 250_000,
  maxStringLength: 1_000_000,
};

export const resolveHydrationLimits = (
  limits: Partial<HydrationLimits> | undefined,
): HydrationLimits => {
  const result = { ...defaultHydrationLimits, ...limits };
  for (const [key, value] of Object.entries(result)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`fate: Hydration limit '${key}' must be a positive integer.`);
    }
  }
  return result;
};

const error = (path: string, message: string): Error =>
  new Error(`fate: Cannot serialize hydration value at '${path}': ${message}`);

const isPlainObject = (value: object): value is AnyRecord => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isDenseArray = (value: ReadonlyArray<unknown>): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      return false;
    }
  }
  return true;
};

const isDate = (value: object): value is Date =>
  Object.prototype.toString.call(value) === '[object Date]' &&
  typeof (value as Date).getTime === 'function' &&
  typeof (value as Date).toISOString === 'function';

export const encodeHydrationValue = (
  value: unknown,
  limits?: Partial<HydrationLimits>,
): FateSerializedValue => {
  const resolvedLimits = resolveHydrationLimits(limits);
  const seen = new Set<object>();
  let nodes = 0;

  const encode = (entry: unknown, path: string, depth: number): EncodedValue => {
    nodes += 1;
    if (nodes > resolvedLimits.maxNodes) {
      throw error(path, `Maximum node count of ${String(resolvedLimits.maxNodes)} exceeded.`);
    }
    if (depth > maxDepth) {
      throw error(path, `Maximum depth of ${String(maxDepth)} exceeded.`);
    }

    if (entry === null) {
      return ['null'];
    }

    const type = typeof entry;
    if (typeof entry === 'string' || typeof entry === 'boolean') {
      if (typeof entry === 'string' && entry.length > resolvedLimits.maxStringLength) {
        throw error(
          path,
          `Maximum string length of ${String(resolvedLimits.maxStringLength)} exceeded.`,
        );
      }
      return [typeof entry, entry];
    }

    if (type === 'number') {
      if (Number.isNaN(entry)) {
        return ['number', 'NaN'];
      }
      if (entry === Infinity) {
        return ['number', 'Infinity'];
      }
      if (entry === -Infinity) {
        return ['number', '-Infinity'];
      }
      if (Object.is(entry, -0)) {
        return ['number', '-0'];
      }
      return ['number', entry as number];
    }

    if (type === 'undefined') {
      return ['undefined'];
    }

    if (type === 'bigint') {
      const bigint = String(entry);
      if (bigint.length > resolvedLimits.maxStringLength) {
        throw error(
          path,
          `Maximum string length of ${String(resolvedLimits.maxStringLength)} exceeded.`,
        );
      }
      return ['bigint', bigint];
    }

    if (type === 'function' || type === 'symbol') {
      throw error(path, `Received unsupported '${type}' value.`);
    }

    if (!entry || typeof entry !== 'object') {
      throw error(path, `Received unsupported '${type}' value.`);
    }

    if (isNodeRef(entry)) {
      const id = getNodeRefId(entry);
      if (id.length > resolvedLimits.maxStringLength) {
        throw error(
          path,
          `Maximum string length of ${String(resolvedLimits.maxStringLength)} exceeded.`,
        );
      }
      return ['ref', id];
    }

    if (isDate(entry)) {
      if (Number.isNaN(entry.getTime())) {
        throw error(path, `Received an invalid Date.`);
      }
      return ['date', entry.toISOString()];
    }

    if (seen.has(entry)) {
      throw error(path, `Circular references are not supported.`);
    }

    seen.add(entry);
    try {
      if (Array.isArray(entry)) {
        if (!isDenseArray(entry)) {
          throw error(path, `Sparse arrays are not supported.`);
        }
        if (entry.length > resolvedLimits.maxCollectionLength) {
          throw error(
            path,
            `Maximum collection length of ${String(resolvedLimits.maxCollectionLength)} exceeded.`,
          );
        }
        return [
          'array',
          entry.map((item, index) => encode(item, `${path}[${String(index)}]`, depth + 1)),
        ];
      }

      if (!isPlainObject(entry)) {
        throw error(path, `Received unsupported '${entry.constructor?.name ?? 'object'}' value.`);
      }

      if (Object.getOwnPropertySymbols(entry).length > 0) {
        throw error(path, `Received an unsupported symbol-keyed property.`);
      }

      const entries = Object.entries(entry);
      if (entries.length > resolvedLimits.maxCollectionLength) {
        throw error(
          path,
          `Maximum collection length of ${String(resolvedLimits.maxCollectionLength)} exceeded.`,
        );
      }
      return [
        'object',
        entries.map(([key, item]) => {
          if (key.length > resolvedLimits.maxStringLength) {
            throw error(
              path,
              `Maximum string length of ${String(resolvedLimits.maxStringLength)} exceeded.`,
            );
          }
          return [key, encode(item, `${path}.${key}`, depth + 1)];
        }),
      ];
    } finally {
      seen.delete(entry);
    }
  };

  return encode(value, 'data', 0);
};

const invalidPayload = (path: string): Error =>
  new Error(`fate: Invalid hydration payload at '${path}'.`);

const tagLengths: Readonly<Record<string, number>> = {
  array: 2,
  bigint: 2,
  boolean: 2,
  date: 2,
  null: 1,
  number: 2,
  object: 2,
  ref: 2,
  string: 2,
  undefined: 1,
};

export const decodeHydrationValue = (
  value: FateSerializedValue,
  limits?: Partial<HydrationLimits>,
): unknown => {
  const resolvedLimits = resolveHydrationLimits(limits);
  let nodes = 0;

  const decode = (entry: FateSerializedValue, path: string, depth: number): unknown => {
    nodes += 1;
    if (
      nodes > resolvedLimits.maxNodes ||
      depth > maxDepth ||
      !Array.isArray(entry) ||
      typeof entry[0] !== 'string'
    ) {
      throw invalidPayload(path);
    }

    const [tag, payload] = entry;
    if (entry.length !== tagLengths[tag]) {
      throw invalidPayload(path);
    }

    switch (tag) {
      case 'null':
        return null;
      case 'undefined':
        return undefined;
      case 'string':
        if (typeof payload !== 'string' || payload.length > resolvedLimits.maxStringLength) {
          throw invalidPayload(path);
        }
        return payload;
      case 'boolean':
        if (typeof payload !== 'boolean') {
          throw invalidPayload(path);
        }
        return payload;
      case 'number':
        if (typeof payload === 'number') {
          if (!Number.isFinite(payload) || Object.is(payload, -0)) {
            throw invalidPayload(path);
          }
          return payload;
        }
        if (payload === 'NaN') {
          return Number.NaN;
        }
        if (payload === 'Infinity') {
          return Infinity;
        }
        if (payload === '-Infinity') {
          return -Infinity;
        }
        if (payload === '-0') {
          return -0;
        }
        throw invalidPayload(path);
      case 'bigint':
        if (typeof payload !== 'string' || payload.length > resolvedLimits.maxStringLength) {
          throw invalidPayload(path);
        }
        try {
          const bigint = BigInt(payload);
          if (String(bigint) !== payload) {
            throw invalidPayload(path);
          }
          return bigint;
        } catch {
          throw invalidPayload(path);
        }
      case 'date': {
        if (typeof payload !== 'string' || payload.length > resolvedLimits.maxStringLength) {
          throw invalidPayload(path);
        }
        const date = new Date(payload);
        if (Number.isNaN(date.getTime()) || date.toISOString() !== payload) {
          throw invalidPayload(path);
        }
        return date;
      }
      case 'ref':
        if (typeof payload !== 'string' || payload.length > resolvedLimits.maxStringLength) {
          throw invalidPayload(path);
        }
        return createNodeRef(payload);
      case 'array':
        if (
          !Array.isArray(payload) ||
          !isDenseArray(payload) ||
          payload.length > resolvedLimits.maxCollectionLength
        ) {
          throw invalidPayload(path);
        }
        return payload.map((item, index) => decode(item, `${path}[${String(index)}]`, depth + 1));
      case 'object': {
        if (!Array.isArray(payload) || payload.length > resolvedLimits.maxCollectionLength) {
          throw invalidPayload(path);
        }
        const result: AnyRecord = Object.create(null);
        for (const item of payload) {
          if (
            !Array.isArray(item) ||
            item.length !== 2 ||
            typeof item[0] !== 'string' ||
            item[0].length > resolvedLimits.maxStringLength
          ) {
            throw invalidPayload(path);
          }
          if (item[0] in result) {
            throw invalidPayload(path);
          }
          result[item[0]] = decode(item[1], `${path}.${item[0]}`, depth + 1);
        }
        return result;
      }
      default:
        throw invalidPayload(path);
    }
  };

  return decode(value, 'data', 0);
};

const isRecord = (value: unknown): value is AnyRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || isNodeRef(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isStringArray = (value: unknown): value is Array<string> =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const hasDuplicates = (values: ReadonlyArray<string>): boolean =>
  new Set(values).size !== values.length;

const isUniqueStringArray = (value: unknown): value is Array<string> =>
  isStringArray(value) && !hasDuplicates(value);

const hasOnlyKeys = (value: AnyRecord, keys: ReadonlySet<string>): boolean =>
  Object.keys(value).every((key) => keys.has(key));

const listKeys = new Set([
  'backwardPageLimit',
  'cursors',
  'forwardPageLimit',
  'ids',
  'liveAfterIds',
  'liveBeforeIds',
  'pagination',
  'pendingAfterIds',
  'pendingBeforeIds',
]);
const paginationKeys = new Set(['hasNext', 'hasPrevious', 'nextCursor', 'previousCursor']);
const clientStateKeys = new Set(['rootLists', 'rootRequests', 'store']);
const storeStateKeys = new Set(['coverage', 'lists', 'records']);

const isEntry = (value: unknown): value is [string, unknown] =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === 'string';

const isOptionalLimit = (value: unknown): value is number | undefined =>
  value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 0);

const isPagination = (value: unknown): value is List['pagination'] =>
  value === undefined ||
  (isRecord(value) &&
    hasOnlyKeys(value, paginationKeys) &&
    typeof value.hasNext === 'boolean' &&
    typeof value.hasPrevious === 'boolean' &&
    (value.nextCursor === undefined || typeof value.nextCursor === 'string') &&
    (value.previousCursor === undefined || typeof value.previousCursor === 'string'));

const isList = (value: unknown): value is List => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, listKeys) ||
    !isStringArray(value.ids) ||
    hasDuplicates(value.ids) ||
    (value.cursors !== undefined &&
      (!Array.isArray(value.cursors) || value.cursors.length !== value.ids.length))
  ) {
    return false;
  }

  return (
    (value.cursors === undefined ||
      (Array.isArray(value.cursors) &&
        value.cursors.every((entry) => entry === undefined || typeof entry === 'string'))) &&
    (value.liveAfterIds === undefined || isUniqueStringArray(value.liveAfterIds)) &&
    (value.liveBeforeIds === undefined || isUniqueStringArray(value.liveBeforeIds)) &&
    isOptionalLimit(value.backwardPageLimit) &&
    isOptionalLimit(value.forwardPageLimit) &&
    isPagination(value.pagination) &&
    (value.pendingAfterIds === undefined || isUniqueStringArray(value.pendingAfterIds)) &&
    (value.pendingBeforeIds === undefined || isUniqueStringArray(value.pendingBeforeIds))
  );
};

const isFieldPath = (value: string): boolean =>
  value.length > 0 && value.split('.').every((segment) => segment.length > 0);

const isFieldPathArray = (value: unknown): value is Array<string> =>
  isUniqueStringArray(value) && value.every(isFieldPath);

const hasDuplicateEntries = (entries: ReadonlyArray<unknown>): boolean =>
  hasDuplicates(entries.map((entry) => (entry as [string, unknown])[0]));

export const decodeClientHydrationState = (
  value: FateSerializedValue,
  limits?: Partial<HydrationLimits>,
): ClientHydrationState => {
  const decoded = decodeHydrationValue(value, limits);
  if (
    !isRecord(decoded) ||
    !hasOnlyKeys(decoded, clientStateKeys) ||
    !Array.isArray(decoded.rootLists) ||
    !Array.isArray(decoded.rootRequests) ||
    !isRecord(decoded.store) ||
    !hasOnlyKeys(decoded.store, storeStateKeys) ||
    !Array.isArray(decoded.store.coverage) ||
    !Array.isArray(decoded.store.lists) ||
    !Array.isArray(decoded.store.records)
  ) {
    throw invalidPayload('data');
  }

  if (
    decoded.rootLists.some((entry) => !isEntry(entry) || !isStringArray(entry[1])) ||
    decoded.rootRequests.some(
      (entry) => !isEntry(entry) || (entry[1] !== null && typeof entry[1] !== 'string'),
    ) ||
    decoded.store.coverage.some((entry) => !isEntry(entry) || !isFieldPathArray(entry[1])) ||
    decoded.store.lists.some((entry) => !isEntry(entry) || !isList(entry[1])) ||
    decoded.store.records.some((entry) => !isEntry(entry) || !isRecord(entry[1]))
  ) {
    throw invalidPayload('data');
  }

  if (
    hasDuplicateEntries(decoded.rootLists) ||
    hasDuplicateEntries(decoded.rootRequests) ||
    hasDuplicateEntries(decoded.store.coverage) ||
    hasDuplicateEntries(decoded.store.lists) ||
    hasDuplicateEntries(decoded.store.records) ||
    decoded.rootLists.some(([, keys]) => hasDuplicates(keys))
  ) {
    throw invalidPayload('data');
  }

  return decoded as ClientHydrationState;
};
