import type { JSONValue } from './protocol.ts';

const maxDepth = 12;
const maxArrayLength = 200;
const maxStringLength = 2000;

/**
 * Converts arbitrary values into plain JSON that can cross a
 * `BroadcastChannel`. Cycles, functions, class instances, and very large
 * values are summarized instead of throwing.
 */
export function toJSONValue(value: unknown, depth = 0, seen = new WeakSet<object>()): JSONValue {
  try {
    return serialize(value, depth, seen);
  } catch {
    return '[Unserializable]';
  }
}

function serialize(value: unknown, depth: number, seen: WeakSet<object>): JSONValue {
  switch (typeof value) {
    case 'string':
      return value.length > maxStringLength
        ? `${value.slice(0, maxStringLength)}… (${value.length} chars)`
        : value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'bigint':
      return `${value}n`;
    case 'undefined':
      return null;
    case 'symbol':
      return value.toString();
    case 'function':
      return `ƒ ${value.name || 'anonymous'}()`;
  }

  if (value === null) {
    return null;
  }

  const object = value as object;
  const tag = Object.prototype.toString.call(object);
  if (tag === '[object Date]') {
    const date = object as Date;
    return Number.isNaN(date.getTime()) ? 'Invalid Date' : date.toISOString();
  }
  if (tag === '[object Error]') {
    const error = object as Error;
    return { message: error.message, name: error.name };
  }
  if (seen.has(object)) {
    return '[Circular]';
  }
  if (depth >= maxDepth) {
    return Array.isArray(object) ? `[Array(${object.length})]` : '[Object]';
  }

  const ref = getNodeRef(object);
  if (ref !== undefined) {
    return { $ref: ref };
  }

  seen.add(object);
  try {
    if (tag === '[object Map]') {
      const map = object as Map<unknown, unknown>;
      return Object.fromEntries(
        [...map]
          .slice(0, maxArrayLength)
          .map(([key, entry]) => [String(key), toJSONValue(entry, depth + 1, seen)]),
      );
    }
    if (tag === '[object Set]' || Array.isArray(object)) {
      const items = [...(object as Iterable<unknown>)];
      const result = items
        .slice(0, maxArrayLength)
        .map((entry) => toJSONValue(entry, depth + 1, seen));
      return items.length > maxArrayLength
        ? [...result, `… ${items.length - maxArrayLength} more`]
        : result;
    }

    const result: Record<string, JSONValue> = {};
    for (const key of Object.keys(object)) {
      let entry: unknown;
      try {
        entry = (object as Record<string, unknown>)[key];
      } catch (error) {
        entry = error;
      }
      result[key] = toJSONValue(entry, depth + 1, seen);
    }
    return result;
  } finally {
    seen.delete(object);
  }
}

/**
 * fate stores relations as frozen objects keyed by a private symbol. The
 * devtools turn them into `{ $ref: 'Type:id' }` so the panel can link to them.
 */
const getNodeRef = (object: object): string | undefined => {
  for (const symbol of Object.getOwnPropertySymbols(object)) {
    if (symbol.description === '__fate__node-ref') {
      const id = (object as Record<symbol, unknown>)[symbol];
      return typeof id === 'string' ? id : undefined;
    }
  }
  return undefined;
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : JSON.stringify(toJSONValue(error));
