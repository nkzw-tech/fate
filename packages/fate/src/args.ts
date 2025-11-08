import {
  __FateArgsBrand,
  __FateVarBrand,
  AnyRecord,
  Args,
  VarReference,
} from './types.ts';

export const args = <A extends AnyRecord>(args: A): Args<A> => {
  const result: AnyRecord = {};
  for (const [key, value] of Object.entries(args)) {
    result[key] = value;
  }

  Object.defineProperty(result, __FateArgsBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });

  return Object.freeze(result) as Args<A>;
};

export const isArgs = (value: unknown): value is Args<AnyRecord> =>
  Boolean(value) &&
  typeof value === 'object' &&
  (value as Args<any>)[__FateArgsBrand] === true;

export const v = <K extends string, T>(
  key: K,
  defaultValue?: T,
): VarReference<K, T> =>
  Object.freeze({
    [__FateVarBrand]: true,
    defaultValue,
    key,
  });

export const isVarReference = (
  value: unknown,
): value is VarReference<string, unknown> =>
  Boolean(value) &&
  typeof value === 'object' &&
  (value as VarReference<any, any>)[__FateVarBrand] === true;

const ensureSerializable = (value: unknown, path: string) => {
  const type = typeof value;
  if (type === 'function' || type === 'symbol') {
    throw new Error(
      `fate: Argument '${path}' must be serializable. Received '${type}'.`,
    );
  }
};

type ResolveArgsOptions = {
  args?: Record<string, unknown> | undefined;
  path?: string;
};

export const resolveArgs = (
  marker: Args<AnyRecord>,
  options: ResolveArgsOptions = {},
): AnyRecord => {
  const rootArgs = options.args ?? {};
  const basePath = options.path ?? '__root';
  const result: AnyRecord = {};

  for (const [key, value] of Object.entries(marker)) {
    const argPath = `${basePath}.${key}`;

    if (isVarReference(value)) {
      const variable = value.key;
      if (variable in rootArgs) {
        const resolved = rootArgs[variable];
        ensureSerializable(resolved, argPath);
        result[key] = resolved;
      } else if (value.defaultValue !== undefined) {
        ensureSerializable(value.defaultValue, argPath);
        result[key] = value.defaultValue;
      } else {
        throw new Error(`fate: Missing value for ${variable}.`);
      }
      continue;
    }

    if (Array.isArray(value)) {
      result[key] = value.map((entry, index) => {
        const entryPath = `${argPath}[${index}]`;
        if (isVarReference(entry)) {
          const variable = entry.key;
          if (variable in rootArgs) {
            const resolved = rootArgs[variable];
            ensureSerializable(resolved, entryPath);
            return resolved;
          }

          if (entry.defaultValue !== undefined) {
            ensureSerializable(entry.defaultValue, entryPath);
            return entry.defaultValue;
          }

          throw new Error(`fate: Missing value for ${variable}.`);
        }

        ensureSerializable(entry, entryPath);
        return entry;
      });
      continue;
    }

    ensureSerializable(value, argPath);
    result[key] = value;
  }

  return result;
};

const stableSerialize = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }

  const type = typeof value;

  if (type === 'number' || type === 'boolean' || type === 'bigint') {
    return `${type}:${String(value)}`;
  }

  if (type === 'string') {
    return `string:${JSON.stringify(value)}`;
  }

  if (type === 'undefined') {
    return 'undefined';
  }

  if (Array.isArray(value)) {
    return `array:[${value.map(stableSerialize).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, entry]) => [key, entry] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(
        ([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`,
      );

    return `object:{${entries.join(',')}}`;
  }

  throw new Error(
    `fate: Unable to serialize argument value of type '${type}'.`,
  );
};

type HashArgsOptions = {
  ignoreKeys?: ReadonlySet<string>;
};

export const hashArgs = (
  argsValue: Record<string, unknown>,
  options: HashArgsOptions = {},
): string => {
  const keys: AnyRecord = {};
  for (const [key, value] of Object.entries(argsValue)) {
    if (options.ignoreKeys && options.ignoreKeys.has(key)) {
      continue;
    }
    keys[key] = value;
  }
  return stableSerialize(keys);
};
