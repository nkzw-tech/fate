import type {
  FateLiveEvent,
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
    transport.subscribeById = (type, id, select, args, handlers) => {
      const controller = new AbortController();
      let lastEventId: string | undefined;
      let retry: ReturnType<typeof setTimeout> | undefined;

      const connect = async () => {
        let shouldReconnect = true;
        try {
          const response = await fetchImpl(liveEndpointUrl, {
            body: JSON.stringify({
              args,
              id,
              lastEventId,
              select: [...select],
              type,
              version: 1,
            }),
            headers: await requestHeaders(
              {
                accept: 'text/event-stream',
                'content-type': 'application/json',
              },
              headers,
            ),
            method: 'POST',
            signal: controller.signal,
          });

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

                if (message.id) {
                  lastEventId = message.id;
                }

                const event = JSON.parse(message.data) as FateLiveEvent;
                if (event.delete === true) {
                  handlers.onDelete?.(event.id ?? id);
                } else if ('data' in event) {
                  handlers.onData(event.data);
                }
              }
            }
          } finally {
            controller.signal.removeEventListener('abort', cancelReader);
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            if (error instanceof FateRequestError && error.status >= 400 && error.status < 500) {
              shouldReconnect = false;
            }
            handlers.onError?.(error);
          }
        } finally {
          if (!controller.signal.aborted && shouldReconnect) {
            retry = setTimeout(() => void connect(), liveRetryMs);
          }
        }
      };

      void connect();

      return () => {
        if (retry) {
          clearTimeout(retry);
        }
        controller.abort();
      };
    };
  }

  return transport;
}
