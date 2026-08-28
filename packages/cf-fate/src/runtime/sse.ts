/* eslint-disable @nkzw/no-instanceof, perfectionist/sort-object-types, perfectionist/sort-objects */

export type SseMessage = {
  data?: unknown;
  event?: string;
  id?: string;
  retry?: number;
};

export type SseTextMessage = Omit<SseMessage, 'data'> & {
  data?: string;
};

export type SseStream = {
  close(): Promise<void>;
  readonly closed: Promise<void>;
  comment(text?: string): Promise<void>;
  send(message: SseMessage): Promise<void>;
  readonly signal: AbortSignal;
};

export type SseKeepAliveOptions =
  | boolean
  | {
      comment?: string;
      intervalMs?: number;
    };

export type EventStreamOptions = {
  headers?: HeadersInit;
  keepAlive?: SseKeepAliveOptions;
  signal?: AbortSignal;
};

type NormalizedKeepAlive = {
  comment: string;
  intervalMs: number;
};

const DEFAULT_KEEP_ALIVE_INTERVAL_MS = 15_000;
const DEFAULT_KEEP_ALIVE_COMMENT = 'keep-alive';

export class SseStreamClosedError extends Error {
  constructor(message = 'sse: stream is closed.') {
    super(message);
    this.name = 'SseStreamClosedError';
  }
}

export function formatSse(message: SseMessage): string {
  const textMessage: SseTextMessage = {
    event: message.event,
    id: message.id,
    retry: message.retry,
  };
  if ('data' in message) {
    textMessage.data = serializeData(message.data);
  }
  return formatSseText(textMessage);
}

export function formatSseText(message: SseTextMessage): string {
  const lines: Array<string> = [];

  if (message.id != null) {
    assertControlField('id', message.id);
    lines.push(`id: ${message.id}`);
  }

  if (message.event != null) {
    assertControlField('event', message.event);
    lines.push(`event: ${message.event}`);
  }

  if (message.retry != null) {
    assertRetry(message.retry);
    lines.push(`retry: ${message.retry}`);
  }

  if ('data' in message) {
    if (typeof message.data !== 'string') {
      throw new Error('sse: data must be a string.');
    }
    for (const line of splitLines(message.data)) {
      lines.push(`data: ${line}`);
    }
  }

  return `${lines.join('\n')}\n\n`;
}

export function getLastEventId(request: Request): string | null {
  return request.headers.get('Last-Event-ID');
}

export function eventStream(
  start: (stream: SseStream) => void | Promise<void>,
  options: EventStreamOptions = {},
): Response {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const signalController = new AbortController();
  const headers = buildSseHeaders(options.headers);
  const keepAlive = normalizeKeepAlive(options.keepAlive);
  let keepAliveTimer: ReturnType<typeof setInterval> | undefined;
  let closedOnce = false;
  let closeResolve: () => void;
  const closed = new Promise<void>((resolve) => {
    closeResolve = resolve;
  });

  const markClosed = (): void => {
    if (closedOnce) {
      return;
    }
    closedOnce = true;
    if (!signalController.signal.aborted) {
      signalController.abort();
    }
    if (keepAliveTimer != null) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = undefined;
    }
    closeResolve();
  };

  async function close(): Promise<void> {
    if (closedOnce) {
      return;
    }
    markClosed();
    await writer.close().catch(() => {});
  }

  async function fail(error: unknown): Promise<void> {
    if (closedOnce) {
      return;
    }
    markClosed();
    await writer.abort(error).catch(() => {});
  }

  async function write(text: string): Promise<void> {
    if (closedOnce) {
      throw new SseStreamClosedError();
    }
    try {
      await writer.write(encoder.encode(text));
    } catch {
      await close();
      throw new SseStreamClosedError();
    }
  }

  const stream: SseStream = {
    close,
    closed,
    comment(text = '') {
      return write(formatComment(text));
    },
    send(message) {
      return write(formatSse(message));
    },
    signal: signalController.signal,
  };

  writer.closed.catch(() => {
    void close();
  });

  if (options.signal?.aborted) {
    void close();
  } else {
    options.signal?.addEventListener('abort', () => void close(), { once: true });
  }

  if (keepAlive) {
    keepAliveTimer = setInterval(() => {
      void stream.comment(keepAlive.comment).catch(() => close());
    }, keepAlive.intervalMs);
  }

  queueMicrotask(() => {
    void (async () => {
      try {
        await start(stream);
        await close();
      } catch (error) {
        await fail(error);
      }
    })();
  });

  return new Response(readable, { headers });
}

function buildSseHeaders(headers: HeadersInit | undefined): Headers {
  const result = new Headers(headers);
  if (!result.has('Content-Type')) {
    result.set('Content-Type', 'text/event-stream; charset=utf-8');
  }
  if (!result.has('Cache-Control')) {
    result.set('Cache-Control', 'no-cache, no-transform');
  }
  if (!result.has('X-Accel-Buffering')) {
    result.set('X-Accel-Buffering', 'no');
  }
  return result;
}

function normalizeKeepAlive(
  keepAlive: SseKeepAliveOptions | undefined,
): NormalizedKeepAlive | null {
  if (keepAlive === false) {
    return null;
  }
  if (keepAlive === true || keepAlive == null) {
    return {
      comment: DEFAULT_KEEP_ALIVE_COMMENT,
      intervalMs: DEFAULT_KEEP_ALIVE_INTERVAL_MS,
    };
  }
  const intervalMs = keepAlive.intervalMs ?? DEFAULT_KEEP_ALIVE_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('sse: keepAlive.intervalMs must be a positive finite number.');
  }
  return {
    comment: keepAlive.comment ?? DEFAULT_KEEP_ALIVE_COMMENT,
    intervalMs,
  };
}

function formatComment(text: string): string {
  if (typeof text !== 'string') {
    throw new Error('sse: comment text must be a string.');
  }
  return `${splitLines(text)
    .map((line) => `: ${line}`)
    .join('\n')}\n\n`;
}

function assertControlField(name: 'event' | 'id', value: string): void {
  if (typeof value !== 'string') {
    throw new Error(`sse: ${name} must be a string.`);
  }
  if (hasControlFieldSeparator(value)) {
    throw new Error(`sse: ${name} must not contain CR, LF, or NUL characters.`);
  }
}

function hasControlFieldSeparator(value: string): boolean {
  return value.includes('\r') || value.includes('\n') || value.includes('\u0000');
}

function assertRetry(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('sse: retry must be a non-negative integer.');
  }
}

function isBinaryData(data: unknown): boolean {
  return (
    data instanceof ArrayBuffer ||
    ArrayBuffer.isView(data) ||
    (typeof Blob !== 'undefined' && data instanceof Blob) ||
    (typeof File !== 'undefined' && data instanceof File)
  );
}

function serializeData(data: unknown): string {
  if (typeof data === 'string') {
    return data;
  }
  if (data == null) {
    return data === null ? 'null' : throwDataSerializationError(data);
  }
  if (typeof data === 'function' || typeof data === 'symbol') {
    return throwDataSerializationError(data);
  }
  if (isBinaryData(data)) {
    throw new Error('sse: binary data is not supported.');
  }
  try {
    const serialized = JSON.stringify(data);
    if (typeof serialized !== 'string') {
      return throwDataSerializationError(data);
    }
    return serialized;
  } catch (error) {
    throw new Error(
      `sse: data must be JSON-serializable. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function throwDataSerializationError(data: unknown): never {
  throw new Error(`sse: unsupported data value ${String(data)}.`);
}

function splitLines(value: string): Array<string> {
  return value.split(/\r\n|\r|\n/);
}
