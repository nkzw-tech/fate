import { getAbsentCursorKeys, hashArgs } from './args.ts';
import type { FateClient } from './client.ts';
import type { List } from './store.ts';
import type { ConnectionMetadata, EntityId, View } from './types.ts';

export type ListEntry = Readonly<{ cursor?: string; id: EntityId }>;

export const getListEntries = (listState: List | undefined): Array<ListEntry> => {
  if (!listState) {
    return [];
  }

  const entries: Array<ListEntry> = [];

  for (const id of listState.pendingBeforeIds ?? []) {
    entries.push({ id });
  }

  listState.ids.forEach((id, index) => {
    entries.push({ cursor: listState.cursors?.[index], id });
  });

  for (const id of listState.pendingAfterIds ?? []) {
    entries.push({ id });
  }

  return entries;
};

export type ListWindow = Readonly<{ end?: string; size: number; start?: string }>;

const argumentKeys = new WeakMap<object, string>();
const projectedLists = new WeakMap<List, Map<string, List>>();

export const getListWindowKey = (
  args: Record<string, unknown> | undefined,
  scope?: string,
): string => {
  if (!args) {
    return scope ? `${scope.length}:${scope}|` : '';
  }
  let key = argumentKeys.get(args);
  if (key === undefined) {
    const absent = getAbsentCursorKeys(args);
    key = hashArgs(args, absent.length ? { ignoreKeys: new Set(absent) } : undefined);
    argumentKeys.set(args, key);
  }
  return scope ? `${scope.length}:${scope}|${key}` : key;
};

const getInsertedIds = (list: List) =>
  list.insertedBeforeIds?.length || list.insertedAfterIds?.length
    ? new Set([...(list.insertedBeforeIds ?? []), ...(list.insertedAfterIds ?? [])])
    : null;

export const getListPageSize = (list: List): number => {
  const inserted = getInsertedIds(list);
  return inserted
    ? list.ids.reduce((size, id) => size + (inserted.has(id) ? 0 : 1), 0)
    : list.ids.length;
};

export const getListWindow = (
  list: List | undefined,
  args: Record<string, unknown> | undefined,
  windowKey: string = getListWindowKey(args),
): List | undefined => {
  if (!list) {
    return list;
  }
  const window = list.windows?.[windowKey];
  const first =
    typeof args?.first === 'number' && Number.isFinite(args.first) && args.first >= 0
      ? Math.trunc(args.first)
      : undefined;
  const last =
    typeof args?.last === 'number' && Number.isFinite(args.last) && args.last >= 0
      ? Math.trunc(args.last)
      : undefined;
  const after = args?.after;
  const before = args?.before;
  if (first === undefined && last === undefined && after == null && before == null && !window) {
    return list;
  }
  if (
    after == null &&
    before == null &&
    !window &&
    (first ?? last ?? Infinity) >= list.ids.length
  ) {
    return list;
  }
  const key = `${getListWindowKey(args)}|${JSON.stringify(window ?? null)}`;
  let cache = projectedLists.get(list);
  const cached = cache?.get(key);
  if (cached) {
    return cached;
  }
  const inserted = getInsertedIds(list);
  const indices = inserted
    ? list.ids.flatMap((id, index) => (inserted.has(id) ? [] : [index]))
    : undefined;
  const length = indices?.length ?? list.ids.length;
  const cursorIndex = (cursor: unknown) => {
    if (cursor == null) {
      return -1;
    }
    return indices
      ? indices.findIndex((index) => list.cursors?.[index] === cursor)
      : (list.cursors?.indexOf(cursor as string) ?? -1);
  };
  const afterIndex = cursorIndex(after);
  const beforeIndex = cursorIndex(before);
  let start =
    after == null ? 0 : afterIndex >= 0 ? afterIndex + 1 : after === list.afterCursor ? 0 : length;
  let end =
    before == null
      ? length
      : beforeIndex >= 0
        ? beforeIndex
        : before === list.beforeCursor
          ? length
          : 0;
  const windowStart = cursorIndex(window?.start);
  const windowEnd = cursorIndex(window?.end);
  if (windowStart >= 0) {
    start = windowStart;
  }
  if (windowEnd >= 0) {
    end = windowEnd + 1;
  }
  const limit = window?.size ?? first ?? last;
  if (limit !== undefined) {
    if (last !== undefined && first === undefined) {
      if (windowStart < 0) {
        start = Math.max(start, end - limit);
      }
    } else if (windowEnd < 0) {
      end = Math.min(end, start + limit);
    }
  }
  let positions: Array<number> | undefined;
  if (indices && inserted) {
    const selected = new Set(indices.slice(start, end));
    positions = list.ids.flatMap((id, index) =>
      selected.has(index) || inserted.has(id) ? [index] : [],
    );
  }
  const firstIndex = indices ? indices[start] : start;
  const lastIndex = indices ? indices[end - 1] : end - 1;
  const ids = positions ? positions.map((index) => list.ids[index]) : list.ids.slice(start, end);
  let result = list;
  if (ids.length !== list.ids.length || start > 0 || end < length) {
    result = {
      ...list,
      cursors: positions
        ? list.cursors
          ? positions.map((index) => list.cursors?.[index])
          : undefined
        : list.cursors?.slice(start, end),
      ids,
      pagination: {
        hasNext: end < length || Boolean(list.pagination?.hasNext),
        hasPrevious: start > 0 || Boolean(list.pagination?.hasPrevious),
        nextCursor:
          lastIndex === undefined || lastIndex < start ? undefined : list.cursors?.[lastIndex],
        previousCursor:
          firstIndex === undefined || start >= end ? undefined : list.cursors?.[firstIndex],
      },
    };
  }
  if (!cache) {
    cache = new Map();
    projectedLists.set(list, cache);
  }
  cache.set(key, result);
  return result;
};

const firstCursor = (list: List | undefined) =>
  list?.cursors?.[0] ?? list?.pagination?.previousCursor;
const lastCursor = (list: List | undefined) =>
  list?.cursors?.at(-1) ?? list?.pagination?.nextCursor;

export const extendListWindow = (
  previous: List | undefined,
  page: List | undefined,
  args: Record<string, unknown> | undefined,
  window: ListWindow | undefined,
  direction: 'forward' | 'backward',
): ListWindow => {
  const inserted = previous ? getInsertedIds(previous) : null;
  const ids = new Set(previous?.ids.filter((id) => !inserted?.has(id)) ?? []);
  const size =
    ids.size + (page?.ids.filter((id) => !ids.has(id) && !inserted?.has(id)).length ?? 0);
  return {
    end:
      direction === 'forward'
        ? (lastCursor(page) ?? window?.end)
        : (window?.end ?? (args?.last === undefined ? lastCursor(previous) : undefined)),
    size,
    start:
      direction === 'backward'
        ? (firstCursor(page) ?? window?.start)
        : (window?.start ?? (args?.first === undefined ? firstCursor(previous) : undefined)),
  };
};

type ConnectionReader = {
  getSnapshot: () => List | undefined;
  load: (view: View<any, any>, direction: 'forward' | 'backward') => Promise<void>;
  subscribe: (listener: () => void) => () => void;
};

/** @internal */
export function createConnectionReader(
  client: FateClient<any, any>,
  metadata: ConnectionMetadata,
): ConnectionReader {
  const pending = new Map<'forward' | 'backward', Promise<void>>();
  const getSnapshot = () =>
    getListWindow(client.store.getListState(metadata.key), metadata.args, metadata.windowKey);
  return {
    getSnapshot,
    load(view: View<any, any>, direction: 'forward' | 'backward') {
      const existing = pending.get(direction);
      if (existing) {
        return existing;
      }
      const pagination = getSnapshot()?.pagination;
      const forward = direction === 'forward';
      const cursor = forward ? pagination?.nextCursor : pagination?.previousCursor;
      if (cursor === undefined || !(forward ? pagination?.hasNext : pagination?.hasPrevious)) {
        return Promise.resolve();
      }
      const { after: _after, before: _before, first, last, ...values } = metadata.args ?? {};
      const size = forward ? (first ?? last) : (last ?? first);
      const args = {
        ...values,
        after: forward ? cursor : undefined,
        before: forward ? undefined : cursor,
        first: forward ? size : undefined,
        last: forward ? undefined : size,
      };
      const loading = client
        .loadConnection(view, metadata, args, { direction })
        .then(() => {})
        .finally(() => pending.delete(direction));
      pending.set(direction, loading);
      return loading;
    },
    subscribe(listener: () => void) {
      return client.store.subscribeList(metadata.key, listener);
    },
  };
}
