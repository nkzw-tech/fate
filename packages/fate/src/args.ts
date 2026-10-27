import { isRecord } from './record.ts';
import { SelectionPlan } from './selection.ts';
import { ResolvedArgsPayload } from './transport.ts';
import { AnyRecord } from './types.ts';

const ensureSerializable = (value: unknown, path: string) => {
  const type = typeof value;
  if (type === 'function' || type === 'symbol') {
    throw new Error(`fate: Argument '${path}' must be serializable. Received '${type}'.`);
  }
};

const cloneValue = (entry: unknown, currentPath: string): unknown => {
  if (Array.isArray(entry)) {
    return entry.map((item, index) => cloneValue(item, `${currentPath}[${index}]`));
  }

  if (isRecord(entry)) {
    const result: AnyRecord = Object.create(null);
    for (const [key, child] of Object.entries(entry)) {
      result[key] = cloneValue(child, `${currentPath}.${key}`);
    }
    return result;
  }

  ensureSerializable(entry, currentPath);
  return entry;
};

export const cloneArgs = (value: AnyRecord, path: string): AnyRecord =>
  cloneValue(value, path) as AnyRecord;

export const paginationArgKeys = new Set(['after', 'before', 'cursor', 'first', 'last']);
const connectionWindowArgKeys = new Set(['first', 'last']);
export const getAbsentCursorKeys = (args: AnyRecord): Array<string> =>
  ['after', 'before', 'cursor'].filter((key) => key in args && args[key] == null);

export const getConnectionWindowIgnoreKeys = (args: AnyRecord): ReadonlySet<string> => {
  const absent = getAbsentCursorKeys(args);
  return absent.length ? new Set([...connectionWindowArgKeys, ...absent]) : connectionWindowArgKeys;
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
      .map(([_key, entry]) => `${JSON.stringify(_key)}:${stableSerialize(entry)}`);

    return `object:{${entries.join(',')}}`;
  }

  throw new Error(`fate: Unable to serialize argument value of type '${type}'.`);
};

export const hashArgs = (
  argsValue: Record<string, unknown>,
  options: {
    ignoreKeys?: ReadonlySet<string>;
  } = {},
): string => {
  const keys: AnyRecord = Object.create(null);
  for (const [key, value] of Object.entries(argsValue)) {
    if (options.ignoreKeys && options.ignoreKeys.has(key)) {
      continue;
    }
    keys[key] = value;
  }
  return stableSerialize(keys);
};

export const hashConnectionArgs = (
  args: AnyRecord,
  ignoreKeys: ReadonlySet<string> = getConnectionWindowIgnoreKeys(args),
): string => {
  const hash = hashArgs(args, { ignoreKeys });
  return args.before != null || args.last != null ? `${hash}:backward` : hash;
};

export const filterConnectionArgs = (
  argsValue: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!argsValue) {
    return undefined;
  }

  const result: AnyRecord = Object.create(null);
  for (const [key, value] of Object.entries(argsValue)) {
    if (!paginationArgKeys.has(key)) {
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

const mergeArgs = (target: AnyRecord, source: AnyRecord) => {
  for (const [key, value] of Object.entries(source)) {
    if (isRecord(value)) {
      const existing = Object.hasOwn(target, key) ? target[key] : undefined;
      if (isRecord(existing)) {
        mergeArgs(existing, value);
      } else {
        target[key] = cloneArgs(value, key);
      }
      continue;
    }

    target[key] = cloneValue(value, key);
  }
};

export const resolvedArgsFromPlan = (plan?: SelectionPlan): ResolvedArgsPayload | undefined => {
  if (!plan || plan.args.size === 0) {
    return undefined;
  }

  const result: AnyRecord = Object.create(null);

  for (const [path, entry] of plan.args.entries()) {
    if (path === '') {
      mergeArgs(result, entry.value);
      continue;
    }

    const segments = path.split('.');
    let current = result;

    segments.forEach((segment, index) => {
      const isLeaf = index === segments.length - 1;

      if (isLeaf) {
        const existing = current[segment];
        if (isRecord(existing)) {
          mergeArgs(existing, entry.value);
        } else {
          current[segment] = cloneArgs(entry.value, path);
        }
        return;
      }

      const existing = current[segment];
      if (isRecord(existing)) {
        current = existing;
        return;
      }

      const next: AnyRecord = Object.create(null);
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

  const result: AnyRecord = hasEntries(base) ? cloneArgs(base, 'args') : Object.create(null);

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

  if (path === '') {
    return payload;
  }

  const segments = path.split('.');
  let current: unknown = payload;

  for (const segment of segments) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
    if (current === undefined) {
      return undefined;
    }
  }

  return isRecord(current) ? (current as AnyRecord) : undefined;
};

export const applyArgsPayloadToPlan = (plan: SelectionPlan, payload: ResolvedArgsPayload) => {
  for (const [path, entry] of plan.args.entries()) {
    const actual = path === '' ? payload : getArgsAtPath(payload, path);
    if (!actual) {
      continue;
    }
    const cloned = cloneArgs(actual, path);
    const prefix = path ? `${path}.` : '';
    for (const childPath of plan.args.keys()) {
      if (childPath !== path && childPath.startsWith(prefix)) {
        const child = childPath.slice(prefix.length).split('.')[0];
        if (!Object.hasOwn(entry.value, child)) {
          delete cloned[child];
        }
      }
    }
    const ignoreKeys = entry.ignoreKeys ? getConnectionWindowIgnoreKeys(cloned) : undefined;
    const hash = ignoreKeys ? hashConnectionArgs(cloned, ignoreKeys) : hashArgs(cloned);
    plan.args.set(path, { hash, ignoreKeys, value: cloned });
  }
};

export const scopeArgsPayload = (
  args: ResolvedArgsPayload,
  scope: string,
): ResolvedArgsPayload | undefined => {
  const segments = scope.split('.');
  const result: AnyRecord = Object.create(null);
  let current = result;

  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = args;
      return;
    }

    const next: AnyRecord = Object.create(null);
    current[segment] = next;
    current = next;
  });

  return result;
};
