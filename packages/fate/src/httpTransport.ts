import type {
  FateLiveControlOperation,
  FateLiveControlRequest,
  FateLiveEvent,
  FateLiveMessage,
  FateOperation,
  FateOperationResult,
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

type PendingOperation = {
  operation: FateOperation;
  reject: (error: unknown) => void;
  resolve: (value: unknown) => void;
};

type LiveSubscription = {
  args: Record<string, unknown> | undefined;
  handlers: Parameters<NonNullable<Transport['subscribeById']>>[4];
  id: string;
  lastEventId?: string;
  select: Array<string>;
  targetId: string | number;
  type: string;
};

type SSEMessage = {
  data: string;
  event?: string;
  id?: string;
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

const createConnectionId = (): string =>
  typeof crypto === 'object' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const appendSearchParam = (url: string, key: string, value: string): string => {
  const hashIndex = url.indexOf('#');
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  const separator = base.includes('?')
    ? base.endsWith('?') || base.endsWith('&')
      ? ''
      : '&'
    : '?';
  return `${base}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}${hash}`;
};

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

const parseSSEMessages = (buffer: string): { messages: Array<SSEMessage>; rest: string } => {
  const messages: Array<SSEMessage> = [];
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? '';

  for (const part of parts) {
    const message: SSEMessage = { data: '' };
    const data: Array<string> = [];

    for (const line of part.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) {
        continue;
      }

      const separator = line.indexOf(':');
      const field = separator === -1 ? line : line.slice(0, separator);
      const rawValue = separator === -1 ? '' : line.slice(separator + 1);
      const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

      if (field === 'data') {
        data.push(value);
      } else if (field === 'event') {
        message.event = value;
      } else if (field === 'id') {
        message.id = value;
      }
    }

    message.data = data.join('\n');
    messages.push(message);
  }

  return { messages, rest };
};

export function createHTTPTransport<
  API extends FateAPIShape,
  Mutations extends TransportMutations = MutationMapFromAPI<API>,
>({
  fetch: fetchImpl = defaultFetch,
  headers,
  live = true,
  liveRetryMs = 1000,
  liveUrl,
  url,
}: {
  fetch?: FetchLike;
  headers?: HeadersFactory;
  live?: boolean;
  liveRetryMs?: number;
  liveUrl?: string | URL;
  url: string | URL;
}): Transport<Mutations> {
  const endpoint = normalizeEndpoint(url);
  const liveEndpointUrl = liveUrl ? String(liveUrl) : liveEndpoint(endpoint);
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

  if (live) {
    const connectionId = createConnectionId();
    const liveSubscriptions = new Map<string, LiveSubscription>();
    let liveController: AbortController | undefined;
    let liveEverConnected = false;
    let liveNextId = 0;
    let liveNeedsResubscribe = false;
    let liveReadyPromise: Promise<void> | undefined;
    let liveRetry: ReturnType<typeof setTimeout> | undefined;
    let liveResubscribeRetry: ReturnType<typeof setTimeout> | undefined;
    let liveControlRetry: ReturnType<typeof setTimeout> | undefined;
    let failedLiveOperations: Array<FateLiveControlOperation> = [];
    let pendingLiveOperations: Array<FateLiveControlOperation> = [];
    let liveOperationScheduled = false;

    const liveError = (error: unknown) => {
      for (const subscription of liveSubscriptions.values()) {
        subscription.handlers.onError?.(error);
      }
    };

    const stopLiveStream = () => {
      if (liveRetry) {
        clearTimeout(liveRetry);
        liveRetry = undefined;
      }
      if (liveResubscribeRetry) {
        clearTimeout(liveResubscribeRetry);
        liveResubscribeRetry = undefined;
      }
      if (liveControlRetry) {
        clearTimeout(liveControlRetry);
        liveControlRetry = undefined;
      }
      liveController?.abort();
      liveController = undefined;
      liveReadyPromise = undefined;
    };

    const sendLiveControl = async (
      operations: Array<FateLiveControlOperation>,
      options: { ensureStream: boolean },
    ) => {
      if (!operations.length) {
        return;
      }

      if (options.ensureStream) {
        await startLiveStream();
      }

      const response = await fetchImpl(liveEndpointUrl, {
        body: JSON.stringify({
          connectionId,
          operations,
          version: 1,
        } satisfies FateLiveControlRequest),
        headers: await requestHeaders(
          {
            'content-type': 'application/json',
          },
          headers,
        ),
        method: 'POST',
      });

      if (!response.ok) {
        throw await responseError(response);
      }

      const payload = assertProtocolResponse(await response.json());
      const results = new Map(payload.results.map((result) => [result.id, result]));

      for (const operation of operations) {
        const result = results.get(operation.id);
        if (!result) {
          liveSubscriptions
            .get(operation.id)
            ?.handlers.onError?.(
              new Error(`fate(http): Missing live result for operation '${operation.id}'.`),
            );
          continue;
        }

        try {
          resultValue(result);
        } catch (error) {
          liveSubscriptions.get(operation.id)?.handlers.onError?.(error);
        }
      }
    };

    const flushLiveOperations = async () => {
      liveOperationScheduled = false;
      const operations = pendingLiveOperations;
      pendingLiveOperations = [];

      try {
        await sendLiveControl(operations, { ensureStream: true });
      } catch (error) {
        if (operations.length) {
          liveNeedsResubscribe = true;
          failedLiveOperations.push(...operations);
          scheduleLiveControlRetry();
        }
        liveError(error);
      }
    };

    const enqueueLiveOperation = (operation: FateLiveControlOperation) => {
      pendingLiveOperations.push(operation);

      if (!liveOperationScheduled) {
        liveOperationScheduled = true;
        queueMicrotask(() => void flushLiveOperations());
      }
    };

    const resubscribeLive = async () => {
      if (liveResubscribeRetry) {
        clearTimeout(liveResubscribeRetry);
        liveResubscribeRetry = undefined;
      }

      const operations = [...liveSubscriptions.values()].map(
        (subscription): FateLiveControlOperation => ({
          args: subscription.args,
          entityId: subscription.targetId,
          id: subscription.id,
          kind: 'subscribe',
          lastEventId: subscription.lastEventId,
          select: subscription.select,
          type: subscription.type,
        }),
      );

      try {
        await sendLiveControl(operations, { ensureStream: false });
        liveNeedsResubscribe = false;
        failedLiveOperations = [];
      } catch (error) {
        liveNeedsResubscribe = true;
        scheduleLiveResubscribe();
        liveError(error);
      }
    };

    const scheduleLiveResubscribe = () => {
      if (!liveController || liveController.signal.aborted || liveResubscribeRetry) {
        return;
      }

      liveResubscribeRetry = setTimeout(() => void resubscribeLive(), liveRetryMs);
    };

    const retryFailedLiveOperations = async () => {
      liveControlRetry = undefined;
      const operations = failedLiveOperations.filter(
        (operation) => operation.kind === 'unsubscribe' || liveSubscriptions.has(operation.id),
      );
      failedLiveOperations = [];

      if (!operations.length) {
        return;
      }

      try {
        await sendLiveControl(operations, { ensureStream: true });
      } catch (error) {
        failedLiveOperations.push(...operations);
        liveNeedsResubscribe = true;
        scheduleLiveControlRetry();
        liveError(error);
      }
    };

    const scheduleLiveControlRetry = () => {
      if (!liveController || liveController.signal.aborted || liveControlRetry) {
        return;
      }

      liveControlRetry = setTimeout(() => void retryFailedLiveOperations(), liveRetryMs);
    };

    function startLiveStream(): Promise<void> {
      if (liveReadyPromise) {
        return liveReadyPromise;
      }

      if (liveRetry) {
        clearTimeout(liveRetry);
        liveRetry = undefined;
      }

      const controller = new AbortController();
      liveController = controller;
      let readySettled = false;
      let resolveReady!: () => void;
      let rejectReady!: (error: unknown) => void;
      liveReadyPromise = new Promise<void>((resolve, reject) => {
        resolveReady = () => {
          readySettled = true;
          resolve();
        };
        rejectReady = (error) => {
          readySettled = true;
          reject(error);
        };
      });

      const connect = async () => {
        let shouldReconnect = true;
        try {
          const response = await fetchImpl(
            appendSearchParam(liveEndpointUrl, 'connectionId', connectionId),
            {
              headers: await requestHeaders(
                {
                  accept: 'text/event-stream',
                },
                headers,
              ),
              method: 'GET',
              signal: controller.signal,
            },
          );

          if (!response.ok) {
            throw await responseError(response);
          }

          if (!response.body) {
            throw new Error('fate(http): Live response did not include a body.');
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          const cancelReader = () => {
            void reader.cancel().catch(() => undefined);
          };
          let buffer = '';

          controller.signal.addEventListener('abort', cancelReader, { once: true });
          resolveReady();
          if (liveEverConnected || liveNeedsResubscribe) {
            void resubscribeLive();
          }
          liveEverConnected = true;

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              const parsed = parseSSEMessages(buffer);
              buffer = parsed.rest;

              for (const message of parsed.messages) {
                if (!message.data) {
                  continue;
                }

                const event = JSON.parse(message.data) as FateLiveMessage;
                const subscription = liveSubscriptions.get(event.id);
                if (!subscription) {
                  continue;
                }

                if (message.id) {
                  subscription.lastEventId = message.id;
                }

                if (event.kind === 'error') {
                  subscription.handlers.onError?.(
                    new FateRequestError(event.error.code, event.error.message, {
                      issues: event.error.issues,
                    }),
                  );
                  continue;
                }

                const liveEvent = event.event as FateLiveEvent;
                if (liveEvent.delete === true) {
                  subscription.handlers.onDelete?.(liveEvent.id ?? subscription.targetId);
                } else if ('data' in liveEvent) {
                  subscription.handlers.onData(liveEvent.data);
                }
              }
            }
          } finally {
            controller.signal.removeEventListener('abort', cancelReader);
          }
        } catch (error) {
          const wasReady = readySettled;
          if (!readySettled) {
            rejectReady(error);
          }

          if (!controller.signal.aborted) {
            if (error instanceof FateRequestError && error.status >= 400 && error.status < 500) {
              shouldReconnect = false;
            }
            if (wasReady) {
              liveError(error);
            }
          }
        } finally {
          if (liveController === controller) {
            liveController = undefined;
            liveReadyPromise = undefined;
          }

          if (!controller.signal.aborted && shouldReconnect && liveSubscriptions.size > 0) {
            liveRetry = setTimeout(
              () => void startLiveStream().catch(() => undefined),
              liveRetryMs,
            );
          }
        }
      };

      void connect();
      return liveReadyPromise;
    }

    transport.subscribeById = (type, id, select, args, handlers) => {
      const liveId = String(++liveNextId);
      liveSubscriptions.set(liveId, {
        args,
        handlers,
        id: liveId,
        select: [...select],
        targetId: id,
        type,
      });

      enqueueLiveOperation({
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

        if (liveSubscriptions.size === 0) {
          pendingLiveOperations = [];
          liveOperationScheduled = false;
          stopLiveStream();
          return;
        }

        enqueueLiveOperation({
          id: liveId,
          kind: 'unsubscribe',
        });
      };
    };
  }

  return transport;
}
