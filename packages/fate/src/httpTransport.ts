import { liveConnectionTopic, liveEntityTopic, liveGlobalConnectionTopic } from './liveTopics.ts';
import type {
  FateOperation,
  FateOperationResult,
  FateLiveConnectionSubscribeOperation,
  FateLiveControlOperation,
  FateLiveControlRequest,
  FateLiveMessage,
  FateLiveSubscribeOperation,
  FateProtocolRequest,
  FateProtocolResponse,
} from './protocol.ts';
import { errorCodeFromStatus, FateRequestError } from './protocol.ts';
import { isRecord } from './record.ts';
import type { Transport } from './transport.ts';
import type { MutationShape, Pagination } from './types.ts';

type TransportMutations = Record<string, MutationShape>;
type EmptyTransportMutations = Record<never, MutationShape>;

type FateAPIShape = {
  mutations?: Record<string, MutationShape>;
};

type MutationMapFromAPI<API> = API extends { mutations: infer Mutations }
  ? Mutations extends TransportMutations
    ? Mutations
    : EmptyTransportMutations
  : EmptyTransportMutations;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type HeadersFactory = HeadersInit | (() => HeadersInit | Promise<HeadersInit>);

type EventSourceConstructor = new (
  url: string,
  options?: { withCredentials?: boolean },
) => {
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
};

type LiveConnectorOptions = {
  eventSource?: EventSourceConstructor;
  fetch?: typeof fetch;
  headers?: HeadersFactory;
  onError?: (error: Error | Event) => void;
  retryDelay?: number;
  withCredentials?: boolean;
};

type LiveConnectorClient = {
  subscribe<Data = unknown>(options: {
    id: string;
    lastEventId?: string;
    onEvent?: (event: VoidLiveClientEvent<Data>) => void;
    topic: string;
  }): Promise<() => Promise<void> | void>;
};

type LiveConnector = (url: string | URL, options?: LiveConnectorOptions) => LiveConnectorClient;

type PendingOperation = {
  operation: FateOperation;
  reject: (error: unknown) => void;
  resolve: (value: unknown) => void;
};

type LiveSubscription = {
  args: Record<string, unknown> | undefined;
  handlers:
    | Parameters<NonNullable<Transport['subscribeById']>>[4]
    | Parameters<NonNullable<Transport['subscribeConnection']>>[5];
  procedure?: string;
  select: Array<string>;
  selectionArgs?: Record<string, unknown> | undefined;
  targetId?: string | number;
  type: string;
};

type LiveEntityPayload = {
  changed?: ReadonlyArray<string>;
  data?: unknown;
  id?: string | number;
  select?: ReadonlyArray<string>;
};

type VoidLiveClientEvent<Data = unknown> = {
  data: Data;
  eventId?: string;
  subscriptionId: string;
  topic: string;
  type?: string;
};

const reportSubscriptionError = (subscription: LiveSubscription, error: unknown) => {
  subscription.handlers.onError?.(error);
};

const notifyLiveData = (
  handlers: Parameters<NonNullable<Transport['subscribeById']>>[4],
  record: unknown,
  select?: ReadonlyArray<string>,
) => {
  if (select) {
    handlers.onData(record, select);
    return;
  }

  handlers.onData(record);
};

const protocolError = (message: FateLiveMessage & { kind: 'error' }) =>
  new FateRequestError(message.error.code, message.error.message, {
    issues: message.error.issues,
  });

const pathsIntersect = (left: string, right: string): boolean =>
  left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);

const filterLiveSelection = (
  select: ReadonlyArray<string>,
  changed?: ReadonlyArray<string>,
): Array<string> | null => {
  if (!changed) {
    return null;
  }

  const changedPaths = changed.filter((path) => path.length > 0);
  if (changedPaths.length === 0) {
    return [];
  }

  const selected = select.filter((path) =>
    changedPaths.some((changedPath) => pathsIntersect(path, changedPath)),
  );
  if (selected.length === 0) {
    return [];
  }

  const result = new Set(selected);
  result.add('id');

  for (const path of select) {
    if (!path.endsWith('.id')) {
      continue;
    }

    const parentPath = path.slice(0, -'.id'.length);
    if (selected.some((selectedPath) => pathsIntersect(selectedPath, parentPath))) {
      result.add(path);
    }
  }

  return [...result];
};

const hasSelectedDataPath = (value: unknown, segments: Array<string>): boolean => {
  if (segments.length === 0) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((entry) => hasSelectedDataPath(entry, segments));
  }

  if (!isRecord(value)) {
    return false;
  }

  const [field, ...rest] = segments;
  return field in value && hasSelectedDataPath(value[field], rest);
};

const canUseLivePayloadData = (data: unknown, select: ReadonlyArray<string>): boolean => {
  if (!isRecord(data)) {
    return false;
  }

  for (const path of select) {
    if (!hasSelectedDataPath(data, path.split('.'))) {
      return false;
    }
  }

  return true;
};

const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

const resolveHeaders = async (headers: HeadersFactory | undefined): Promise<HeadersInit> =>
  typeof headers === 'function' ? await headers() : (headers ?? {});

const requestHeaders = async (
  defaults: HeadersInit,
  headers: HeadersFactory | undefined,
): Promise<Headers> => {
  const result = new Headers(defaults);
  const custom = new Headers(await resolveHeaders(headers));

  custom.forEach((value, key) => {
    result.set(key, value);
  });

  return result;
};

const normalizeEndpoint = (url: string | URL): string => String(url).replace(/\/$/, '');

const liveEndpoint = (url: string): string => `${normalizeEndpoint(url)}/live`;

const responseError = async (response: Response): Promise<Error> => {
  let message = response.statusText || `HTTP ${response.status}`;
  try {
    const payload = (await response.clone().json()) as unknown;
    if (
      isRecord(payload) &&
      Array.isArray(payload.results) &&
      isRecord(payload.results[0]) &&
      isRecord(payload.results[0].error) &&
      typeof payload.results[0].error.message === 'string'
    ) {
      message = payload.results[0].error.message;
    }
  } catch {
    try {
      const text = await response.text();
      if (text) {
        message = text;
      }
    } catch {
      // Keep the status text fallback.
    }
  }

  return new FateRequestError(errorCodeFromStatus(response.status), message, {
    status: response.status,
  });
};

const assertProtocolResponse = (value: unknown): FateProtocolResponse => {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.results) ||
    value.results.some((entry) => !isRecord(entry) || typeof entry.id !== 'string')
  ) {
    throw new Error('fate(http): Invalid protocol response.');
  }

  return value as FateProtocolResponse;
};

const resultValue = (result: FateOperationResult): unknown => {
  if (result.ok) {
    return result.data;
  }

  throw new FateRequestError(result.error.code, result.error.message, {
    issues: result.error.issues,
  });
};

export function createHTTPTransport<
  API extends FateAPIShape,
  Mutations extends TransportMutations = MutationMapFromAPI<API>,
>({
  eventSource,
  fetch: fetchImpl = defaultFetch,
  headers,
  live = true,
  liveRetryMs = 1000,
  liveUrl,
  url,
}: {
  eventSource?: EventSourceConstructor;
  fetch?: FetchLike;
  headers?: HeadersFactory;
  live?: boolean | LiveConnector;
  liveRetryMs?: number;
  liveUrl?: string | URL;
  url: string | URL;
}): Transport<Mutations> {
  const endpoint = normalizeEndpoint(url);
  const liveEndpointUrl = liveUrl ? String(liveUrl) : liveEndpoint(endpoint);
  const liveConnector = typeof live === 'function' ? live : undefined;
  const liveEnabled = live !== false;
  let nextId = 0;
  let pending: Array<PendingOperation> = [];
  let scheduled = false;

  const enqueue = (operation: Omit<FateOperation, 'id'>) =>
    new Promise<unknown>((resolve, reject) => {
      pending.push({
        operation: {
          ...operation,
          id: String(++nextId),
        },
        reject,
        resolve,
      });

      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });

  const flush = async () => {
    scheduled = false;
    const batch = pending;
    pending = [];

    if (!batch.length) {
      return;
    }

    try {
      const response = await fetchImpl(endpoint, {
        body: JSON.stringify({
          operations: batch.map((entry) => entry.operation),
          version: 1,
        } satisfies FateProtocolRequest),
        headers: await requestHeaders({ 'content-type': 'application/json' }, headers),
        method: 'POST',
      });
      if (!response.ok) {
        throw await responseError(response);
      }
      const payload = assertProtocolResponse(await response.json());
      const results = new Map(payload.results.map((result) => [result.id, result]));

      for (const entry of batch) {
        const result = results.get(entry.operation.id);
        if (!result) {
          entry.reject(
            new Error(`fate(http): Missing result for operation '${entry.operation.id}'.`),
          );
          continue;
        }

        try {
          entry.resolve(resultValue(result));
        } catch (error) {
          entry.reject(error);
        }
      }
    } catch (error) {
      for (const entry of batch) {
        entry.reject(error);
      }
    }
  };

  const transport: Transport<Mutations> = {
    fetchById(type, ids, select, args) {
      return enqueue({
        args,
        ids,
        kind: 'byId',
        select: [...select],
        type,
      }) as Promise<Array<unknown>>;
    },
    fetchList(name, select, args) {
      return enqueue({
        args,
        kind: 'list',
        name,
        select: [...select],
      }) as Promise<{
        items: Array<{ cursor: string | undefined; node: unknown }>;
        pagination: Pagination;
      }>;
    },
    fetchQuery(name, select, args) {
      return enqueue({
        args,
        kind: 'query',
        name,
        select: [...select],
      });
    },
    mutate(name, input, select) {
      return enqueue({
        input,
        kind: 'mutation',
        name,
        select: [...select],
      }) as Promise<Mutations[Extract<keyof Mutations, string>]['output']>;
    },
  };

  if (liveEnabled) {
    const liveSubscriptions = new Map<string, LiveSubscription>();
    let liveClient: LiveConnectorClient | undefined;
    let nativeLiveClient:
      | {
          add(operation: FateLiveConnectionSubscribeOperation | FateLiveSubscribeOperation): void;
          remove(id: string): void;
        }
      | undefined;
    let liveNextId = 0;
    const getLiveClient = () => {
      if (!liveConnector) {
        throw new Error('fate(http): A live connector is required for topic subscriptions.');
      }

      return (liveClient ??= liveConnector(liveEndpointUrl, {
        eventSource,
        fetch: fetchImpl as typeof fetch,
        headers,
        onError(error) {
          for (const subscription of new Set(liveSubscriptions.values())) {
            subscription.handlers.onError?.(error);
          }
        },
        retryDelay: liveRetryMs,
        withCredentials: true,
      }));
    };

    const getNativeLiveClient = () => {
      if (nativeLiveClient) {
        return nativeLiveClient;
      }

      const EventSourceCtor =
        eventSource ??
        (globalThis as typeof globalThis & { EventSource?: EventSourceConstructor }).EventSource;
      if (!EventSourceCtor) {
        throw new Error('fate(http): EventSource is required for live views.');
      }

      const connectionId =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const operations = new Map<
        string,
        FateLiveConnectionSubscribeOperation | FateLiveSubscribeOperation
      >();
      const lastEventIds = new Map<string, string>();
      let opened = false;
      let resolveOpen: (() => void) | undefined;
      let rejectOpen: ((error: Error | Event) => void) | undefined;
      const open = new Promise<void>((resolve, reject) => {
        resolveOpen = resolve;
        rejectOpen = reject;
      });
      const sourceUrl = new URL(
        liveEndpointUrl,
        typeof globalThis.location === 'object' ? globalThis.location.href : 'http://local',
      );
      sourceUrl.searchParams.set('connectionId', connectionId);
      const source = new EventSourceCtor(sourceUrl.href, { withCredentials: true });

      const control = async (controlOperations: Array<FateLiveControlOperation>) => {
        const response = await fetchImpl(liveEndpointUrl, {
          body: JSON.stringify({
            connectionId,
            operations: controlOperations,
            version: 1,
          } satisfies FateLiveControlRequest),
          headers: await requestHeaders({ 'content-type': 'application/json' }, headers),
          method: 'POST',
        });
        if (!response.ok) {
          throw await responseError(response);
        }

        const payload = assertProtocolResponse(await response.json());
        for (const result of payload.results) {
          resultValue(result);
        }
      };

      const withLastEventId = <
        Operation extends FateLiveConnectionSubscribeOperation | FateLiveSubscribeOperation,
      >(
        operation: Operation,
      ): Operation => {
        const lastEventId = lastEventIds.get(operation.id);
        return lastEventId ? { ...operation, lastEventId } : operation;
      };

      const reportError = (error: Error | Event) => {
        for (const subscription of new Set(liveSubscriptions.values())) {
          reportSubscriptionError(subscription, error);
        }
      };

      source.addEventListener('open', () => {
        if (!opened) {
          opened = true;
          resolveOpen?.();
          return;
        }

        const resubscribe = [...operations.values()].map(withLastEventId);
        if (resubscribe.length > 0) {
          void control(resubscribe).catch(reportError);
        }
      });
      const handleLiveMessage = (event: Event) => {
        const message = JSON.parse((event as MessageEvent).data as string) as FateLiveMessage;
        const subscription = liveSubscriptions.get(message.id);
        if (!subscription) {
          return;
        }

        const lastEventId = (event as MessageEvent).lastEventId;
        if (lastEventId) {
          lastEventIds.set(message.id, lastEventId);
        }

        if (message.kind === 'error') {
          reportSubscriptionError(subscription, protocolError(message));
          return;
        }

        if (message.kind === 'connection') {
          if ('onEvent' in subscription.handlers) {
            subscription.handlers.onEvent(message.event);
          }
          return;
        }

        if ('delete' in message.event && message.event.delete) {
          if ('onDelete' in subscription.handlers) {
            subscription.handlers.onDelete?.(message.event.id ?? subscription.targetId!);
          }
          return;
        }

        if ('onData' in subscription.handlers) {
          notifyLiveData(subscription.handlers, message.event.data, message.event.select);
        }
      };

      source.addEventListener('error', (event) => {
        if ('data' in event) {
          handleLiveMessage(event);
          return;
        }

        if (!opened) {
          rejectOpen?.(event);
        }
        reportError(event);
      });
      source.addEventListener('message', handleLiveMessage);
      source.addEventListener('next', handleLiveMessage);
      source.addEventListener('connection', handleLiveMessage);

      nativeLiveClient = {
        add(operation) {
          operations.set(operation.id, operation);
          void open
            .then(() => control([withLastEventId(operation)]))
            .catch((error) => {
              operations.delete(operation.id);
              liveSubscriptions.delete(operation.id);
              reportError(error);
            });
        },
        remove(id) {
          operations.delete(id);
          lastEventIds.delete(id);
          void open
            .then(() =>
              control([
                {
                  id,
                  kind: 'unsubscribe',
                },
              ]),
            )
            .catch(reportError);
          if (operations.size === 0) {
            source.close();
            nativeLiveClient = undefined;
          }
        },
      };

      return nativeLiveClient;
    };

    const fetchLiveRecord = async (
      subscription: LiveSubscription,
      select: ReadonlyArray<string> = subscription.select,
    ) => {
      const [record] = await transport.fetchById(
        subscription.type,
        [subscription.targetId!],
        select,
        subscription.args,
      );
      return record;
    };

    const resolveConnectionNode = async (
      subscription: LiveSubscription,
      id: string | number,
      nodeType: string,
    ) => {
      const [record] = await transport.fetchById(
        nodeType,
        [id],
        subscription.select,
        subscription.selectionArgs,
      );
      return record;
    };

    transport.subscribeById = (type, id, select, args, handlers) => {
      const liveId = String(++liveNextId);
      const subscription: LiveSubscription = {
        args,
        handlers,
        select: [...select],
        targetId: id,
        type,
      };
      liveSubscriptions.set(liveId, subscription);
      if (!liveConnector) {
        getNativeLiveClient().add({
          args,
          entityId: id,
          id: liveId,
          kind: 'subscribe',
          select: [...select],
          type,
        });

        return () => {
          if (!liveSubscriptions.delete(liveId)) {
            return;
          }
          getNativeLiveClient().remove(liveId);
        };
      }

      const unsubscribePromise = getLiveClient()
        .subscribe<LiveEntityPayload>({
          id: liveId,
          onEvent(event) {
            if (event.type === 'delete') {
              handlers.onDelete?.(event.data.id ?? id);
              return;
            }

            const explicitSelect = Array.isArray(event.data.select) ? event.data.select : null;
            const liveSelect =
              explicitSelect ?? filterLiveSelection(subscription.select, event.data.changed);
            if (liveSelect?.length === 0) {
              return;
            }

            if ('data' in event.data && event.data.data !== undefined) {
              if (!liveSelect || canUseLivePayloadData(event.data.data, liveSelect)) {
                notifyLiveData(handlers, event.data.data, liveSelect ?? undefined);
                return;
              }
            }

            void fetchLiveRecord(subscription, liveSelect ?? subscription.select)
              .then((record) => {
                if (record == null) {
                  handlers.onDelete?.(id);
                } else {
                  notifyLiveData(handlers, record, liveSelect ?? undefined);
                }
              })
              .catch((error) => reportSubscriptionError(subscription, error));
          },
          topic: liveEntityTopic(type, id),
        })
        .catch((error) => {
          liveSubscriptions.delete(liveId);
          reportSubscriptionError(subscription, error);
          return null;
        });

      return () => {
        if (!liveSubscriptions.delete(liveId)) {
          return;
        }
        void unsubscribePromise.then((unsubscribe) => unsubscribe?.());
      };
    };

    transport.subscribeConnection = (procedure, type, args, select, selectionArgs, handlers) => {
      const liveId = String(++liveNextId);
      const globalLiveId = `${liveId}:global`;
      const subscription: LiveSubscription = {
        args,
        handlers,
        procedure,
        select: [...select],
        selectionArgs,
        type,
      };
      const handleEvent = (event: VoidLiveClientEvent) => {
        const data = isRecord(event.data) ? event.data : {};
        if (event.type === 'invalidate') {
          handlers.onEvent({ type: 'invalidate' });
          return;
        }

        const nodeType = typeof data.nodeType === 'string' ? data.nodeType : type;
        const id = data.id;
        if (event.type === 'deleteEdge') {
          if (typeof id === 'string' || typeof id === 'number') {
            handlers.onEvent({ id, nodeType, type: 'deleteEdge' });
          } else {
            reportSubscriptionError(
              subscription,
              new Error(
                `fate(http): Live connection delete event for '${procedure}' missed an id.`,
              ),
            );
          }
          return;
        }

        if (
          event.type !== 'appendEdge' &&
          event.type !== 'appendNode' &&
          event.type !== 'insertEdgeAfter' &&
          event.type !== 'insertEdgeBefore' &&
          event.type !== 'prependEdge' &&
          event.type !== 'prependNode'
        ) {
          return;
        }

        const eventType = event.type;
        const sendNode = (node: unknown) => {
          handlers.onEvent({
            edge: {
              cursor: typeof data.cursor === 'string' ? data.cursor : undefined,
              node,
            },
            nodeType,
            targetCursor: typeof data.targetCursor === 'string' ? data.targetCursor : undefined,
            type: eventType,
          });
        };

        if ('node' in data && data.node !== undefined) {
          sendNode(data.node);
          return;
        }

        if (typeof id !== 'string' && typeof id !== 'number') {
          reportSubscriptionError(
            subscription,
            new Error(`fate(http): Live connection event for '${procedure}' missed a node id.`),
          );
          return;
        }

        void resolveConnectionNode(subscription, id, nodeType)
          .then(sendNode)
          .catch((error) => reportSubscriptionError(subscription, error));
      };

      liveSubscriptions.set(liveId, subscription);
      if (!liveConnector) {
        getNativeLiveClient().add({
          args,
          id: liveId,
          kind: 'subscribeConnection',
          procedure,
          select: [...select],
          selectionArgs,
          type,
        });

        return () => {
          if (!liveSubscriptions.delete(liveId)) {
            return;
          }
          getNativeLiveClient().remove(liveId);
        };
      }

      liveSubscriptions.set(globalLiveId, subscription);
      const client = getLiveClient();
      const unsubscribeSpecific = client.subscribe({
        id: liveId,
        onEvent: handleEvent,
        topic: liveConnectionTopic(procedure, args),
      });
      const unsubscribeGlobal = client.subscribe({
        id: globalLiveId,
        onEvent: handleEvent,
        topic: liveGlobalConnectionTopic(procedure),
      });
      const unsubscribePromise = Promise.all([unsubscribeSpecific, unsubscribeGlobal]).catch(
        (error) => {
          liveSubscriptions.delete(liveId);
          liveSubscriptions.delete(globalLiveId);
          reportSubscriptionError(subscription, error);
          return [];
        },
      );

      return () => {
        const deleted = liveSubscriptions.delete(liveId) || liveSubscriptions.delete(globalLiveId);
        if (!deleted) {
          return;
        }
        liveSubscriptions.delete(globalLiveId);
        void unsubscribePromise.then((unsubscribers) =>
          Promise.all(unsubscribers.map((unsubscribe) => unsubscribe())),
        );
      };
    };
  }

  return transport;
}
