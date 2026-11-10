/**
 * Messages exchanged between an app running fate and the devtools panel.
 *
 * Both sides talk over a `BroadcastChannel`, so the panel works inside the
 * Vite DevTools dock (served from the dev server's origin) and as a standalone
 * tab on the same origin.
 */

export const channelName = 'fate-devtools';

export type JSONValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JSONValue>
  | { readonly [key: string]: JSONValue };

export type OperationKind =
  | 'fetchById'
  | 'fetchList'
  | 'fetchQuery'
  | 'mutate'
  | 'mutateDurably'
  | 'subscribeById'
  | 'subscribeConnection';

export type OperationStatus = 'pending' | 'success' | 'error' | 'live' | 'closed';

export type OperationEntry = Readonly<{
  args?: JSONValue;
  endedAt?: number;
  error?: string;
  /** Number of live events received by a subscription. */
  events?: number;
  id: number;
  input?: JSONValue;
  kind: OperationKind;
  /** The entity type, list procedure, query procedure, or mutation name. */
  name: string;
  result?: JSONValue;
  select: ReadonlyArray<string>;
  startedAt: number;
  status: OperationStatus;
}>;

export type ChangeEntry = Readonly<{
  at: number;
  id: number;
  invalidated?: boolean;
  key: string;
  kind: 'record' | 'list';
  optimistic: boolean;
  paths?: ReadonlyArray<string>;
}>;

export type RecordEntry = Readonly<{
  /** Field paths fate knows are loaded for this record. */
  coverage: ReadonlyArray<string>;
  id: string;
  /** Lists that contain this record. */
  lists: ReadonlyArray<string>;
  /** The record differs from the server-confirmed value. */
  optimistic: boolean;
  rawId: string;
  record: JSONValue;
  stale: ReadonlyArray<string>;
  type: string;
}>;

export type ListEntry = Readonly<{
  field: string;
  ids: ReadonlyArray<string>;
  key: string;
  optimistic: boolean;
  owner: string;
  pagination?: JSONValue;
  state: JSONValue;
}>;

export type RequestItemEntry = Readonly<{
  args?: JSONValue;
  ids?: ReadonlyArray<string>;
  kind: string;
  name: string;
  paths: ReadonlyArray<string>;
  procedure?: string;
  type: string;
}>;

export type RequestEntry = Readonly<{
  items: ReadonlyArray<RequestItemEntry>;
  key: string;
  modes: ReadonlyArray<Readonly<{ mode: string; status: string }>>;
  /** Number of active retainers (mounted components, manual `retain` calls). */
  retainers: number;
}>;

export type LiveEntry = Readonly<{ key: string; subscribers: number }>;

export type ClientSnapshot = Readonly<{
  changes: ReadonlyArray<ChangeEntry>;
  hydrationScope?: string;
  id: string;
  lists: ReadonlyArray<ListEntry>;
  live: ReadonlyArray<LiveEntry>;
  mutations: ReadonlyArray<string>;
  name: string;
  operations: ReadonlyArray<OperationEntry>;
  optimisticUpdates: boolean;
  persistence?: JSONValue;
  records: ReadonlyArray<RecordEntry>;
  requests: ReadonlyArray<RequestEntry>;
  roots: ReadonlyArray<string>;
  takenAt: number;
  types: ReadonlyArray<string>;
}>;

export type ClientSummary = Readonly<{
  id: string;
  name: string;
  /** Identifies the page (tab) the client runs in. */
  pageId: string;
  url: string;
}>;

/** The app page exposes its page id here so an embedded panel can pick its own clients. */
export const pageIdGlobal = '__FATE_DEVTOOLS_PAGE_ID__';

export type DevtoolsAction =
  | Readonly<{ type: 'gc' }>
  | Readonly<{ type: 'clear-log' }>
  | Readonly<{ id: string; type: 'invalidate-record' }>
  | Readonly<{ type: 'invalidate-all' }>
  | Readonly<{ id: string; type: 'delete-record' }>
  | Readonly<{ id: string; type: 'log-record' }>;

export type AppMessage =
  | Readonly<{ client: ClientSummary; source: 'fate-devtools:app'; type: 'connected' }>
  | Readonly<{ clientId: string; source: 'fate-devtools:app'; type: 'disconnected' }>
  | Readonly<{ snapshot: ClientSnapshot; source: 'fate-devtools:app'; type: 'snapshot' }>;

export type PanelMessage =
  | Readonly<{ source: 'fate-devtools:panel'; type: 'discover' }>
  | Readonly<{
      clientId: string;
      panelId: string;
      source: 'fate-devtools:panel';
      type: 'watch' | 'unwatch';
    }>
  | Readonly<{
      action: DevtoolsAction;
      clientId: string;
      source: 'fate-devtools:panel';
      type: 'action';
    }>;

export const isAppMessage = (value: unknown): value is AppMessage =>
  typeof value === 'object' &&
  value !== null &&
  (value as { source?: unknown }).source === 'fate-devtools:app';

export const isPanelMessage = (value: unknown): value is PanelMessage =>
  typeof value === 'object' &&
  value !== null &&
  (value as { source?: unknown }).source === 'fate-devtools:panel';

const listKeySeparator = ' __fate__ ';

const decodeListKeyPart = (part: string) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

/**
 * Splits a fate list key (`owner __fate__ field __fate__ hash`) into its parts.
 * Root lists are owned by `__root__`.
 */
export const parseListKey = (key: string): { field: string; hash: string; owner: string } => {
  const parts = key.split(listKeySeparator);
  return parts.length >= 3
    ? {
        field: decodeListKeyPart(parts[1]),
        hash: decodeListKeyPart(parts[2]),
        owner: decodeListKeyPart(parts[0]),
      }
    : { field: key, hash: 'default', owner: '' };
};
