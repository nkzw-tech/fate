/**
 * Devtools for fate.
 *
 * Connect a client in development and open the "fate" panel in Vite DevTools,
 * or visit `/__fate-devtools/` on your dev server.
 *
 * @example
 * import { connectFateDevtools } from '@nkzw/fate-devtools';
 *
 * if (import.meta.env.DEV) {
 *   connectFateDevtools(fate);
 * }
 *
 * @module @nkzw/fate-devtools
 */

import type { FateClient } from '@nkzw/fate';
import {
  channelName,
  isPanelMessage,
  pageIdGlobal,
  parseListKey,
  type AppMessage,
  type ChangeEntry,
  type ClientSnapshot,
  type ClientSummary,
  type DevtoolsAction,
  type ListEntry,
  type OperationEntry,
  type OperationKind,
  type RecordEntry,
  type RequestEntry,
} from './protocol.ts';
import { errorMessage, toJSONValue } from './serialize.ts';

export type FateDevtoolsOptions = Readonly<{
  /** Number of network operations and cache changes kept in the log. Defaults to 300. */
  logSize?: number;
  /** Shown in the panel when more than one client is connected. Defaults to `fate`. */
  name?: string;
}>;

type AnyFn = (...args: Array<any>) => any;
type MutableOperation = { -readonly [K in keyof OperationEntry]: OperationEntry[K] };

type StoreState = Readonly<{
  coverage: ReadonlyArray<readonly [string, ReadonlyArray<string>]>;
  lists: ReadonlyArray<readonly [string, AnyListState]>;
  records: ReadonlyArray<readonly [string, unknown]>;
  stale?: ReadonlyArray<readonly [string, ReadonlyArray<string>]>;
}>;

type AnyListState = Readonly<{ ids: ReadonlyArray<string>; pagination?: unknown }>;

type StoreChange = Readonly<{
  invalidated?: true;
  key: string;
  kind: 'list' | 'record';
  paths?: Iterable<string>;
}>;

/**
 * The parts of `FateClient` and its store that the devtools read. Most of
 * these are implementation details, so every access is optional and guarded.
 */
type InspectableClient = {
  deleteRecord?: (type: string, id: string) => void;
  gc?: () => void;
  hydrationScope?: unknown;
  liveSubscriptions?: Map<string, { count?: number }>;
  mutations?: object;
  operationLifetime?: { operations?: Map<string, { refCount?: number }> };
  persistence?: { getSnapshot?: () => unknown; subscribe?: (listener: () => void) => () => void };
  requests?: Map<string, Map<string, { descriptor?: AnyRequestDescriptor; status?: string }>>;
  roots?: object;
  store?: {
    dehydrate?: () => StoreState;
    dehydrateConfirmed?: () => StoreState;
    getListKeysForEntity?: (id: string) => ReadonlyArray<string>;
    hasOptimisticUpdates?: boolean;
    invalidateRecord?: (id: string) => void;
    isRecordingOptimistic?: boolean;
    onChange?: (change: StoreChange, owner?: unknown) => void;
  };
  transport?: Record<string, unknown>;
  types?: Map<string, unknown>;
};

type AnyRequestDescriptor = Readonly<{
  items?: ReadonlyArray<{
    argsPayload?: unknown;
    ids?: ReadonlyArray<string | number>;
    kind?: string;
    name?: string;
    plan?: { paths?: Iterable<string> };
    procedure?: string;
    type?: string;
  }>;
  key?: string;
}>;

const operationKinds = new Set<OperationKind>([
  'fetchById',
  'fetchList',
  'fetchQuery',
  'mutate',
  'mutateDurably',
  'subscribeById',
  'subscribeConnection',
]);

const watcherTimeout = 5000;
const snapshotDelay = 120;
const maxRecords = 5000;

const pageId = Math.random().toString(36).slice(2, 10);
let nextClientId = 0;

const parseEntityId = (id: string) => {
  const index = id.indexOf(':');
  return index < 0
    ? { rawId: id, type: '' }
    : { rawId: id.slice(index + 1), type: id.slice(0, index) };
};

const nestedKeys = (value: unknown, prefix = ''): Array<string> => {
  if (!value || typeof value !== 'object') {
    return [];
  }
  return Object.entries(value).flatMap(([key, entry]) =>
    typeof entry === 'function' ? [`${prefix}${key}`] : nestedKeys(entry, `${prefix}${key}.`),
  );
};

const toPaths = (select: unknown): ReadonlyArray<string> => {
  if (!select || typeof select !== 'object' || !(Symbol.iterator in select)) {
    return [];
  }
  return [...(select as Iterable<unknown>)].map(String).sort();
};

/** Keeps a bounded log, dropping the oldest entries first. */
class RingLog<T> {
  private entries: Array<T> = [];
  constructor(private readonly size: number) {}

  push(entry: T) {
    this.entries.push(entry);
    if (this.entries.length > this.size) {
      this.entries.splice(0, this.entries.length - this.size);
    }
  }

  clear() {
    this.entries = [];
  }

  values(): ReadonlyArray<T> {
    return this.entries;
  }
}

type Connection = {
  dispose: () => void;
  refCount: number;
};

const connections = new WeakMap<object, Connection>();

/**
 * Connects a fate client to the devtools panel. Returns a function that
 * disconnects it again and restores the client's original transport.
 *
 * Connecting the same client more than once is safe; the client stays
 * connected until every returned disposer has been called.
 *
 * The devtools are intended for development. Guard the call with
 * `import.meta.env.DEV` (or your bundler's equivalent) to keep them out of
 * production bundles.
 */
export function connectFateDevtools(
  client: FateClient<any, any, any>,
  options: FateDevtoolsOptions = {},
): () => void {
  if (typeof BroadcastChannel === 'undefined') {
    return () => {};
  }

  const existing = connections.get(client);
  if (existing) {
    existing.refCount++;
    return once(() => release(client, existing));
  }

  const connection: Connection = {
    dispose: attach(client as unknown as InspectableClient, options),
    refCount: 1,
  };
  connections.set(client, connection);
  return once(() => release(client, connection));
}

const once = (fn: () => void) => {
  let called = false;
  return () => {
    if (!called) {
      called = true;
      fn();
    }
  };
};

const release = (client: object, connection: Connection) => {
  connection.refCount--;
  if (connection.refCount === 0) {
    connections.delete(client);
    connection.dispose();
  }
};

function attach(client: InspectableClient, options: FateDevtoolsOptions): () => void {
  const logSize = options.logSize ?? 300;
  (globalThis as Record<string, unknown>)[pageIdGlobal] = pageId;
  const summary: ClientSummary = {
    id: `${pageId}:${nextClientId++}`,
    name: options.name ?? 'fate',
    pageId,
    url: typeof location === 'undefined' ? '' : location.href,
  };
  const channel = new BroadcastChannel(channelName);
  const operations = new RingLog<MutableOperation>(logSize);
  const changes = new RingLog<ChangeEntry>(logSize);
  const watchers = new Map<string, number>();
  let nextOperationId = 0;
  let nextChangeId = 0;
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const post = (message: AppMessage) => {
    if (!disposed) {
      channel.postMessage(message);
    }
  };

  const isWatched = () => {
    const now = Date.now();
    for (const [watcher, lastSeen] of watchers) {
      if (now - lastSeen > watcherTimeout) {
        watchers.delete(watcher);
      }
    }
    return watchers.size > 0;
  };

  const sendSnapshot = () => {
    snapshotTimer = undefined;
    if (!disposed && isWatched()) {
      post({ snapshot: takeSnapshot(), source: 'fate-devtools:app', type: 'snapshot' });
    }
  };

  const scheduleSnapshot = () => {
    if (snapshotTimer === undefined && watchers.size > 0) {
      snapshotTimer = setTimeout(sendSnapshot, snapshotDelay);
    }
  };

  // Network activity: wrap every transport method the client calls.
  const originalTransport = client.transport;
  if (originalTransport) {
    const wrapped = new Map<PropertyKey, AnyFn>();
    client.transport = new Proxy(originalTransport, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function' || !operationKinds.has(property as OperationKind)) {
          return value;
        }
        let fn = wrapped.get(property);
        if (!fn) {
          fn = instrument(property as OperationKind, value.bind(target));
          wrapped.set(property, fn);
        }
        return fn;
      },
    });
  }

  function instrument(kind: OperationKind, fn: AnyFn): AnyFn {
    return (...args: Array<any>) => {
      const entry = startOperation(kind, args);
      operations.push(entry);
      scheduleSnapshot();

      const settle = (status: 'success' | 'error', value: unknown) => {
        entry.endedAt = Date.now();
        entry.status = status;
        if (status === 'error') {
          entry.error = errorMessage(value);
        } else {
          entry.result = toJSONValue(value);
        }
        scheduleSnapshot();
      };

      if (kind === 'subscribeById' || kind === 'subscribeConnection') {
        const handlerIndex = kind === 'subscribeById' ? 4 : 5;
        const handlers = args[handlerIndex] as Record<string, AnyFn> | undefined;
        if (handlers) {
          const event =
            (name: string) =>
            (...eventArgs: Array<unknown>) => {
              entry.events = (entry.events ?? 0) + 1;
              entry.result = toJSONValue(eventArgs[0]);
              scheduleSnapshot();
              return handlers[name]?.(...eventArgs);
            };
          args[handlerIndex] = {
            ...handlers,
            ...(handlers.onData && { onData: event('onData') }),
            ...(handlers.onDelete && { onDelete: event('onDelete') }),
            ...(handlers.onEvent && { onEvent: event('onEvent') }),
            onError: (error: unknown) => {
              entry.error = errorMessage(error);
              entry.status = 'error';
              scheduleSnapshot();
              handlers.onError?.(error);
            },
          };
        }
        try {
          const unsubscribe = fn(...args) as () => void;
          entry.status = 'live';
          return () => {
            entry.endedAt = Date.now();
            if (entry.status === 'live') {
              entry.status = 'closed';
            }
            scheduleSnapshot();
            return unsubscribe();
          };
        } catch (error) {
          settle('error', error);
          throw error;
        }
      }

      try {
        const result = fn(...args);
        Promise.resolve(result).then(
          (value) => settle('success', value),
          (error) => settle('error', error),
        );
        return result;
      } catch (error) {
        settle('error', error);
        throw error;
      }
    };
  }

  function startOperation(kind: OperationKind, args: Array<any>): MutableOperation {
    const base = { id: nextOperationId++, kind, startedAt: Date.now(), status: 'pending' as const };
    switch (kind) {
      case 'fetchById':
        return {
          ...base,
          args: toJSONValue(args[3]),
          input: toJSONValue({ ids: args[1] }),
          name: String(args[0]),
          select: toPaths(args[2]),
        };
      case 'fetchList':
      case 'fetchQuery':
        return {
          ...base,
          args: toJSONValue(args[2]),
          name: String(args[0]),
          select: toPaths(args[1]),
        };
      case 'mutate':
        return {
          ...base,
          args: toJSONValue(args[3]),
          input: toJSONValue(args[1]),
          name: String(args[0]),
          select: toPaths(args[2]),
        };
      case 'mutateDurably':
        return {
          ...base,
          args: toJSONValue(args[4]),
          input: toJSONValue({ identity: args[3], input: args[1] }),
          name: String(args[0]),
          select: toPaths(args[2]),
        };
      case 'subscribeById':
        return {
          ...base,
          args: toJSONValue(args[3]),
          input: toJSONValue({ id: args[1] }),
          name: String(args[0]),
          select: toPaths(args[2]),
        };
      case 'subscribeConnection':
        return {
          ...base,
          args: toJSONValue({ args: args[2], selectionArgs: args[4] }),
          input: toJSONValue({ type: args[1] }),
          name: String(args[0]),
          select: toPaths(args[3]),
        };
    }
  }

  // Cache activity: observe every change the store publishes.
  const store = client.store;
  const hadOwnOnChange = !!store && Object.hasOwn(store, 'onChange');
  const originalOnChange = store?.onChange;
  if (store) {
    store.onChange = (change, owner) => {
      try {
        changes.push({
          at: Date.now(),
          id: nextChangeId++,
          ...(change.invalidated && { invalidated: true }),
          key: String(change.key),
          kind: change.kind,
          optimistic: !!store.isRecordingOptimistic || !!store.hasOptimisticUpdates,
          ...(change.paths && { paths: [...change.paths].map(String) }),
        });
        scheduleSnapshot();
      } catch {
        // Never break the client because of the devtools.
      }
      return originalOnChange?.call(store, change, owner);
    };
  }

  const unsubscribePersistence = client.persistence?.subscribe?.(scheduleSnapshot);

  function takeSnapshot(): ClientSnapshot {
    const state = store?.dehydrate?.() ?? { coverage: [], lists: [], records: [] };
    const confirmed = store?.hasOptimisticUpdates ? store.dehydrateConfirmed?.() : undefined;
    const confirmedRecords = confirmed ? new Map(confirmed.records) : undefined;
    const confirmedLists = confirmed ? new Map(confirmed.lists) : undefined;
    const coverage = new Map(state.coverage);
    const stale = new Map(state.stale ?? []);

    const records: Array<RecordEntry> = state.records.slice(0, maxRecords).map(([id, record]) => {
      const { rawId, type } = parseEntityId(String(id));
      return {
        coverage: coverage.get(id) ?? [],
        id,
        lists: store?.getListKeysForEntity?.(id) ?? [],
        optimistic: !!confirmedRecords && confirmedRecords.get(id) !== record,
        rawId,
        record: toJSONValue(record),
        stale: stale.get(id) ?? [],
        type,
      };
    });

    const lists: Array<ListEntry> = state.lists.map(([key, list]) => {
      const { field, owner } = parseListKey(key);
      return {
        field,
        ids: list.ids.map(String),
        key,
        optimistic: !!confirmedLists && confirmedLists.get(key) !== list,
        owner,
        ...(list.pagination !== undefined && { pagination: toJSONValue(list.pagination) }),
        state: toJSONValue(list),
      };
    });

    return {
      changes: [...changes.values()],
      ...(typeof client.hydrationScope === 'string' && { hydrationScope: client.hydrationScope }),
      id: summary.id,
      lists,
      live: [...(client.liveSubscriptions ?? [])].map(([key, subscription]) => ({
        key,
        subscribers: subscription.count ?? 0,
      })),
      mutations: nestedKeys(client.mutations).sort(),
      name: summary.name,
      operations: operations.values().map((entry) => ({ ...entry })),
      optimisticUpdates: !!store?.hasOptimisticUpdates,
      ...(client.persistence?.getSnapshot && {
        persistence: toJSONValue(client.persistence.getSnapshot()),
      }),
      records,
      requests: getRequests(client),
      roots: Object.keys(client.roots ?? {}).sort(),
      takenAt: Date.now(),
      types: [...(client.types?.keys() ?? [])].sort(),
    };
  }

  function runAction(action: DevtoolsAction) {
    switch (action.type) {
      case 'gc':
        client.gc?.();
        break;
      case 'clear-log':
        operations.clear();
        changes.clear();
        break;
      case 'invalidate-record':
        store?.invalidateRecord?.(action.id);
        break;
      case 'invalidate-all':
        for (const [id] of store?.dehydrate?.().records ?? []) {
          store?.invalidateRecord?.(id);
        }
        break;
      case 'delete-record': {
        const { rawId, type } = parseEntityId(action.id);
        client.deleteRecord?.(type, rawId);
        break;
      }
      case 'log-record': {
        const record = store?.dehydrate?.().records.find(([id]) => id === action.id)?.[1];
        (globalThis as { $fate?: unknown }).$fate = record;
        // eslint-disable-next-line no-console
        console.log(`fate-devtools: ${action.id} (available as $fate)`, record);
        break;
      }
    }
    scheduleSnapshot();
  }

  const onMessage = (event: MessageEvent) => {
    const message = event.data;
    if (!isPanelMessage(message)) {
      return;
    }
    if (message.type === 'discover') {
      post({ client: summary, source: 'fate-devtools:app', type: 'connected' });
      return;
    }
    if (message.clientId !== summary.id) {
      return;
    }
    switch (message.type) {
      case 'watch': {
        const isNew = !watchers.has(message.panelId);
        watchers.set(message.panelId, Date.now());
        if (isNew) {
          sendSnapshot();
        }
        break;
      }
      case 'unwatch':
        watchers.delete(message.panelId);
        break;
      case 'action':
        try {
          runAction(message.action);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('fate-devtools: Action failed.', error);
        }
        break;
    }
  };

  channel.addEventListener('message', onMessage);
  post({ client: summary, source: 'fate-devtools:app', type: 'connected' });

  const onPageHide = () =>
    post({ clientId: summary.id, source: 'fate-devtools:app', type: 'disconnected' });
  globalThis.addEventListener?.('pagehide', onPageHide);

  return () => {
    onPageHide();
    disposed = true;
    globalThis.removeEventListener?.('pagehide', onPageHide);
    if (snapshotTimer !== undefined) {
      clearTimeout(snapshotTimer);
    }
    unsubscribePersistence?.();
    channel.removeEventListener('message', onMessage);
    channel.close();
    if (originalTransport) {
      client.transport = originalTransport;
    }
    if (store) {
      if (hadOwnOnChange) {
        store.onChange = originalOnChange;
      } else {
        delete store.onChange;
      }
    }
  };
}

function getRequests(client: InspectableClient): Array<RequestEntry> {
  const retained = client.operationLifetime?.operations;
  const entries = new Map<string, RequestEntry>();
  const add = (descriptor: AnyRequestDescriptor | undefined, mode?: string, status?: string) => {
    const key = descriptor?.key;
    if (!key) {
      return;
    }
    const existing = entries.get(key);
    const modes = existing?.modes ?? [];
    entries.set(key, {
      items:
        existing?.items ??
        (descriptor.items ?? []).map((item) => ({
          ...(item.argsPayload !== undefined && { args: toJSONValue(item.argsPayload) }),
          ...(item.ids && { ids: item.ids.map(String) }),
          kind: String(item.kind ?? ''),
          name: String(item.name ?? ''),
          paths: toPaths(item.plan?.paths),
          ...(item.procedure && { procedure: item.procedure }),
          type: String(item.type ?? ''),
        })),
      key,
      modes: mode ? [...modes, { mode, status: status ?? 'unknown' }] : modes,
      retainers: retained?.get(key)?.refCount ?? 0,
    });
  };

  for (const [, modes] of client.requests ?? []) {
    for (const [mode, handle] of modes) {
      add(handle.descriptor, mode, handle.status);
    }
  }
  for (const [, operation] of retained ?? []) {
    add((operation as { descriptor?: AnyRequestDescriptor }).descriptor);
  }
  return [...entries.values()];
}
