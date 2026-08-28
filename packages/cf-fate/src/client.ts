/* eslint-disable @nkzw/no-instanceof, perfectionist/sort-object-types, perfectionist/sort-objects */

import type { LiveClientEvent, LiveControlOperation, LiveControlResponse } from './runtime/live.ts';

export type LiveSubscribeOptions<Data = unknown> = {
  id: string;
  lastEventId?: string;
  onEvent?: (event: LiveClientEvent<Data>) => void;
  topic: string;
};

export type ConnectLiveStreamOptions = {
  eventSource?: EventSourceConstructor;
  fetch?: typeof fetch;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  keepOpen?: boolean;
  onError?: (error: Event | Error) => void;
  retryDelay?: number;
  withCredentials?: boolean;
};

export type LiveClient = {
  close(): void;
  readonly connectionId: string;
  subscribe<Data = unknown>(options: LiveSubscribeOptions<Data>): Promise<() => Promise<void>>;
};

type EventSourceLike = {
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
};

type EventSourceConstructor = new (
  url: string,
  options?: { withCredentials?: boolean },
) => EventSourceLike;

type Subscription = {
  id: string;
  lastEventId?: string;
  onEvent?: (event: LiveClientEvent) => void;
  topic: string;
};

type PendingOperation = {
  operation: LiveControlOperation;
  reject: (error: unknown) => void;
  resolve: () => void;
};

export function connectCloudflareFateStream(
  url: string | URL,
  options: ConnectLiveStreamOptions = {},
): LiveClient {
  const EventSourceCtor =
    options.eventSource ?? (globalThis as { EventSource?: EventSourceConstructor }).EventSource;
  if (!EventSourceCtor) {
    throw new Error('live: EventSource is not available in this runtime.');
  }
  const ResolvedEventSource = EventSourceCtor;
  const fetchImpl = options.fetch ?? fetch;
  const connectionId = crypto.randomUUID();
  const subscriptions = new Map<string, Subscription>();
  const subscriptionVersions = new Map<string, number>();
  let source: EventSourceLike | null = null;
  let openPromise: Promise<void> | null = null;
  let rejectOpen: ((error: Error) => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let resubscribeOnNextOpen = false;
  let resubscribeWithNextFlush = false;
  let closed = false;
  let pendingOperations: Array<PendingOperation> = [];
  let pendingFlush: Promise<void> | null = null;
  let flushChain: Promise<void> = Promise.resolve();
  let nextSubscriptionVersion = 0;
  const retryDelay = options.retryDelay ?? 1000;
  if (!Number.isFinite(retryDelay) || retryDelay < 0) {
    throw new Error('live: retryDelay must be a non-negative finite number.');
  }

  function streamUrl(): string {
    const resolved = new URL(String(url), globalThis.location?.href);
    resolved.searchParams.set('connectionId', connectionId);
    return resolved.href;
  }

  function ensureOpen(): Promise<void> {
    if (closed) {
      return Promise.reject(new Error('live: stream is closed.'));
    }
    const shouldResubscribe = resubscribeOnNextOpen;
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (openPromise) {
      return openPromise;
    }
    resubscribeOnNextOpen = false;
    if (shouldResubscribe) {
      resubscribeWithNextFlush = true;
    }
    return openSource(false);
  }

  function openSource(resubscribeOnOpen: boolean): Promise<void> {
    const current = new ResolvedEventSource(streamUrl(), {
      withCredentials: options.withCredentials,
    });
    source = current;
    let opened = false;
    openPromise = new Promise<void>((resolve, reject) => {
      rejectOpen = reject;
      const onOpen = (): void => {
        if (source !== current) {
          return;
        }
        if (!opened) {
          opened = true;
          rejectOpen = null;
          resolve();
          if (resubscribeOnOpen) {
            void resubscribeAll().catch(reportError);
          }
          return;
        }
        void resubscribeAll().catch(reportError);
      };
      const onError = (event: Event): void => {
        reportError(event);
        if (source !== current) {
          return;
        }
        if (!opened) {
          current.removeEventListener('open', onOpen);
          current.removeEventListener('error', onError);
          current.removeEventListener('message', onMessage);
          current.close();
          source = null;
          openPromise = null;
          rejectOpen = null;
          reject(new Error('live: stream failed to open.'));
          if (resubscribeOnOpen) {
            scheduleReconnectTimer();
          }
          return;
        }
        scheduleReconnect(current);
      };
      current.addEventListener('open', onOpen);
      current.addEventListener('error', onError);
      current.addEventListener('message', onMessage);
    });
    return openPromise;
  }

  function scheduleReconnect(current: EventSourceLike): void {
    if (closed || reconnectTimer != null) {
      return;
    }
    current.close();
    if (source === current) {
      source = null;
      openPromise = null;
    }
    if (!options.keepOpen && subscriptions.size === 0) {
      return;
    }
    scheduleReconnectTimer();
  }

  function scheduleReconnectTimer(): void {
    if (closed || reconnectTimer != null || (!options.keepOpen && subscriptions.size === 0)) {
      return;
    }
    resubscribeOnNextOpen = true;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (closed || (!options.keepOpen && subscriptions.size === 0)) {
        resubscribeOnNextOpen = false;
        return;
      }
      resubscribeOnNextOpen = false;
      void openSource(true).catch((error) => {
        if (!closed) {
          reportError(error);
        }
      });
    }, retryDelay);
  }

  function reportError(error: Event | Error | unknown): void {
    if (error instanceof Event || error instanceof Error) {
      options.onError?.(error);
    } else {
      options.onError?.(new Error(String(error)));
    }
  }

  function onMessage(raw: Event): void {
    const message = raw as MessageEvent;
    let event: LiveClientEvent;
    try {
      event = JSON.parse(String(message.data)) as LiveClientEvent;
    } catch (error) {
      reportError(error);
      return;
    }
    const subscription = subscriptions.get(event.subscriptionId);
    if (!subscription) {
      return;
    }
    if (subscription.topic !== event.topic) {
      return;
    }
    if (event.eventId) {
      subscription.lastEventId = event.eventId;
    }
    subscription.onEvent?.(event);
  }

  function enqueue(operation: LiveControlOperation): Promise<void> {
    const promise = new Promise<void>((resolve, reject) => {
      pendingOperations.push({ operation, reject, resolve });
    });
    scheduleFlush();
    return promise;
  }

  function scheduleFlush(): void {
    if (pendingFlush) {
      return;
    }
    const scheduled = flushChain.then(flush);
    pendingFlush = scheduled;
    flushChain = scheduled.catch(() => {});
    void scheduled.finally(() => {
      if (pendingFlush === scheduled) {
        pendingFlush = null;
      }
      if (pendingOperations.length > 0) {
        scheduleFlush();
      }
    });
  }

  async function flush(): Promise<void> {
    const pending = pendingOperations;
    pendingOperations = [];
    if (pending.length === 0) {
      return;
    }
    try {
      await ensureOpen();
      let operations = pending.map((entry) => entry.operation);
      if (resubscribeWithNextFlush) {
        resubscribeWithNextFlush = false;
        const pendingIds = new Set(operations.map((operation) => operation.id));
        operations = [
          ...[...subscriptions.values()]
            .filter((subscription) => !pendingIds.has(subscription.id))
            .map((subscription): LiveControlOperation => ({
              id: subscription.id,
              kind: 'subscribe',
              topic: subscription.topic,
              ...(subscription.lastEventId !== undefined && {
                lastEventId: subscription.lastEventId,
              }),
            })),
          ...operations,
        ];
      }
      const headers = new Headers(
        typeof options.headers === 'function' ? await options.headers() : options.headers,
      );
      headers.set('content-type', 'application/json');
      const response = await fetchImpl(String(url), {
        body: JSON.stringify({
          connectionId,
          operations,
        }),
        credentials: options.withCredentials ? 'include' : 'same-origin',
        headers,
        method: 'POST',
      });
      const result = (await response.json()) as LiveControlResponse;
      if (!response.ok || !result.accepted) {
        throw new Error(result.accepted ? response.statusText : result.error.message);
      }
      const remaining = [...result.results];
      for (const entry of pending) {
        const index = remaining.findIndex(
          (item) => item.id === entry.operation.id && item.kind === entry.operation.kind,
        );
        const item = index === -1 ? undefined : remaining.splice(index, 1)[0];
        if (!item) {
          entry.reject(new Error(`live: missing control result for ${entry.operation.id}.`));
        } else if (item.ok) {
          entry.resolve();
        } else {
          entry.reject(new Error(item.error.message));
        }
      }
    } catch (error) {
      for (const entry of pending) {
        entry.reject(error);
      }
    }
  }

  async function resubscribeAll(): Promise<void> {
    const activeSubscriptions = [...subscriptions.values()];
    if (activeSubscriptions.length === 0) {
      return;
    }
    await Promise.all(
      activeSubscriptions.map((subscription) =>
        enqueue({
          id: subscription.id,
          kind: 'subscribe',
          topic: subscription.topic,
          ...(subscription.lastEventId !== undefined && { lastEventId: subscription.lastEventId }),
        }),
      ),
    );
  }

  function closeIfIdle(): void {
    if (!options.keepOpen && subscriptions.size === 0) {
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      resubscribeOnNextOpen = false;
      resubscribeWithNextFlush = false;
      source?.close();
      source = null;
      openPromise = null;
      rejectOpen = null;
    }
  }

  return {
    close() {
      const closeError = new Error('live: stream is closed.');
      closed = true;
      subscriptions.clear();
      subscriptionVersions.clear();
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      resubscribeOnNextOpen = false;
      resubscribeWithNextFlush = false;
      for (const entry of pendingOperations) {
        entry.reject(closeError);
      }
      pendingOperations = [];
      rejectOpen?.(closeError);
      rejectOpen = null;
      source?.close();
      source = null;
      openPromise = null;
    },
    connectionId,
    async subscribe(subscribeOptions) {
      const version = ++nextSubscriptionVersion;
      const previousSubscription = subscriptions.get(subscribeOptions.id);
      const previousVersion = subscriptionVersions.get(subscribeOptions.id);
      subscriptionVersions.set(subscribeOptions.id, version);
      const subscription: Subscription = {
        id: subscribeOptions.id,
        topic: subscribeOptions.topic,
        lastEventId: subscribeOptions.lastEventId,
        onEvent: subscribeOptions.onEvent as ((event: LiveClientEvent) => void) | undefined,
      };
      subscriptions.set(subscription.id, subscription);
      try {
        await enqueue({
          kind: 'subscribe',
          id: subscription.id,
          topic: subscription.topic,
          ...(subscription.lastEventId !== undefined && { lastEventId: subscription.lastEventId }),
        });
      } catch (error) {
        if (subscriptionVersions.get(subscription.id) === version) {
          if (previousSubscription) {
            subscriptions.set(subscription.id, previousSubscription);
            if (previousVersion != null) {
              subscriptionVersions.set(subscription.id, previousVersion);
            } else {
              subscriptionVersions.delete(subscription.id);
            }
          } else {
            subscriptions.delete(subscription.id);
            subscriptionVersions.delete(subscription.id);
          }
        }
        queueMicrotask(closeIfIdle);
        throw error;
      }
      if (closed) {
        throw new Error('live: stream is closed.');
      }
      let unsubscribed = false;
      return async () => {
        if (unsubscribed) {
          return;
        }
        unsubscribed = true;
        if (
          subscriptionVersions.get(subscription.id) !== version ||
          subscriptions.get(subscription.id) !== subscription
        ) {
          return;
        }
        subscriptions.delete(subscription.id);
        subscriptionVersions.delete(subscription.id);
        try {
          await enqueue({ kind: 'unsubscribe', id: subscription.id });
        } finally {
          closeIfIdle();
        }
      };
    },
  };
}
