import { isRecord } from './record.ts';
import { SelectionPlan } from './selection.ts';
import { ResolvedArgsPayload } from './transport.ts';
import { AnyRecord } from './types.ts';

const ensureSerializable = (value: unknown, path: string) => {
  const type = typeof value;
  if (type === 'function' || type === 'symbol') {
    throw new Error(
      `fate: Argument '${path}' must be serializable. Received '${type}'.`,
    );
  }
};

export const cloneArgs = (value: AnyRecord, path: string): AnyRecord => {
  const cloneValue = (entry: unknown, currentPath: string): unknown => {
    if (Array.isArray(entry)) {
      return entry.map((item, index) =>
        cloneValue(item, `${currentPath}[${index}]`),
      );
    }

    if (isRecord(entry)) {
      const result: AnyRecord = {};
      for (const [key, child] of Object.entries(entry)) {
        result[key] = cloneValue(child, `${currentPath}.${key}`);
      }
      return result;
    }

    ensureSerializable(entry, currentPath);
    return entry;
  };

  return cloneValue(value, path) as AnyRecord;
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
        ([_key, entry]) => `${JSON.stringify(_key)}:${stableSerialize(entry)}`,
      );

    return `object:{${entries.join(',')}}`;
  }

  throw new Error(
    `fate: Unable to serialize argument value of type '${type}'.`,
  );
};

export const hashArgs = (
  argsValue: Record<string, unknown>,
  options: {
    ignoreKeys?: ReadonlySet<string>;
  } = {},
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

const mergeArgs = (target: AnyRecord, source: AnyRecord) => {
  for (const [key, value] of Object.entries(source)) {
    if (isRecord(value)) {
      const existing = target[key];
      if (isRecord(existing)) {
        mergeArgs(existing, value);
      } else {
        target[key] = { ...value };
      }
      continue;
    }

    target[key] = value;
  }
};

export const resolvedArgsFromPlan = (
  plan?: SelectionPlan,
): ResolvedArgsPayload | undefined => {
  if (!plan || plan.args.size === 0) {
    return undefined;
  }

  const result: AnyRecord = {};

  for (const [path, entry] of plan.args.entries()) {
    const segments = path.split('.');
    let current = result;

    segments.forEach((segment, index) => {
      const isLeaf = index === segments.length - 1;

      if (isLeaf) {
        const existing = current[segment];
        if (isRecord(existing)) {
          mergeArgs(existing, entry.value);
        } else {
          current[segment] = { ...entry.value };
        }
        return;
      }

      const existing = current[segment];
      if (isRecord(existing)) {
        current = existing;
        return;
      }

      const next: AnyRecord = {};
      current[segment] = next;
      current = next;
    });
  }

  return result;
};

const hasEntries = (value?: AnyRecord): value is AnyRecord =>
  Boolean(value && Object.keys(value).length > 0);

export const combineArgsPayload = (
  base?: AnyRecord,
  scoped?: ResolvedArgsPayload,
): ResolvedArgsPayload | undefined => {
  if (!hasEntries(base) && !hasEntries(scoped)) {
    return undefined;
  }

  const result: AnyRecord = hasEntries(base) ? { ...base } : {};

  if (hasEntries(scoped)) {
    mergeArgs(result, scoped);
  }

  return result;
};

export const getArgsAtPath = (
  payload: ResolvedArgsPayload | undefined,
  path: string,
): AnyRecord | undefined => {
  if (!payload) {
    return undefined;
  }

  const segments = path.split('.');
  let current: unknown = payload;

  for (const segment of segments) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
    if (current === undefined) {
      return undefined;
    }
  }

  return isRecord(current) ? (current as AnyRecord) : undefined;
};

export const applyArgsPayloadToPlan = (
  plan: SelectionPlan,
  payload: ResolvedArgsPayload | undefined,
) => {
  if (!payload) {
    return;
  }

  for (const [path, entry] of plan.args.entries()) {
    const actual = getArgsAtPath(payload, path);
    if (!actual) {
      continue;
    }
    const cloned = cloneArgs(actual, path);
    const hash = hashArgs(cloned, { ignoreKeys: entry.ignoreKeys });
    plan.args.set(path, { hash, ignoreKeys: entry.ignoreKeys, value: cloned });
  }
};

export const scopeArgsPayload = (
  args: ResolvedArgsPayload | undefined,
  scope?: string | null,
): ResolvedArgsPayload | undefined => {
  if (!scope) {
    return hasEntries(args) ? args : undefined;
  }

  if (!hasEntries(args)) {
    return undefined;
  }

  const segments = scope.split('.');
  const result: AnyRecord = {};
  let current = result;

  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = args;
      return;
    }

    const next: AnyRecord = {};
    current[segment] = next;
    current = next;
  });

  return result;
};
