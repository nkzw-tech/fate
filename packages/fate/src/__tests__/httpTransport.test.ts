import { expect, test, vi } from 'vite-plus/test';
import { createHTTPTransport } from '../httpTransport.ts';
import { liveConnectionTopic, liveEntityTopic, liveGlobalConnectionTopic } from '../liveTopics.ts';

const jsonResponse = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  });

const requestHeadersFor = async (
  headers: HeadersInit | (() => HeadersInit | Promise<HeadersInit>),
) => {
  const fetch = vi.fn(async () =>
    jsonResponse({
      results: [{ data: { id: '1' }, id: '1', ok: true }],
      version: 1,
    }),
  );
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    fetch,
    headers,
    url: '/fate',
  });

  await transport.fetchQuery?.('viewer', new Set(['id']));

  const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
  return new Headers(calls[0]?.[1].headers);
};

type TestLiveConnector = Exclude<
  NonNullable<Parameters<typeof createHTTPTransport>[0]['live']>,
  boolean
>;

class MockEventSource {
  static instances: Array<MockEventSource> = [];

  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  closed = false;

  constructor(
    readonly url: string,
    readonly options?: { withCredentials?: boolean },
  ) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, event: Event = new Event(type)) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  message(data: unknown, type = 'message') {
    this.emit(type, { data: JSON.stringify(data) } as MessageEvent);
  }

  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener);
  }
}

const resetMockEventSource = () => {
  MockEventSource.instances = [];
  return MockEventSource;
};

const liveControlFetch = () =>
  vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    return jsonResponse({
      accepted: true,
      connectionId: body.connectionId,
      results: body.operations.map(
        (operation: { id: string; kind: 'subscribe' | 'unsubscribe'; topic?: string }) => ({
          id: operation.id,
          kind: operation.kind,
          ok: true,
          ...(operation.topic && { topic: operation.topic }),
        }),
      ),
      version: 1,
    });
  });

const liveConnector = () =>
  ((url, options) => {
    const EventSourceCtor = options?.eventSource ?? MockEventSource;
    const fetch = options?.fetch ?? globalThis.fetch;
    const connectionId = crypto.randomUUID();
    const sourceUrl = new URL(String(url), 'http://local');
    sourceUrl.searchParams.set('connectionId', connectionId);
    const source = new EventSourceCtor(sourceUrl.href, {
      withCredentials: options?.withCredentials,
    });
    const open = new Promise<void>((resolve, reject) => {
      source.addEventListener('open', () => resolve());
      source.addEventListener('error', (event) => {
        options?.onError?.(event);
        reject(new Error('live: stream failed to open.'));
      });
    });
    const subscriptions = new Map<string, { onEvent?: (event: any) => void; topic: string }>();
    let pending: Array<{ id: string; resolve: () => void; topic: string }> = [];
    let scheduled = false;
    const enqueue = (id: string, topic: string) =>
      new Promise<void>((resolve) => {
        pending.push({ id, resolve, topic });
        if (scheduled) {
          return;
        }
        scheduled = true;
        queueMicrotask(async () => {
          scheduled = false;
          const batch = pending;
          pending = [];
          await fetch(String(url), {
            body: JSON.stringify({
              connectionId,
              operations: batch.map((entry) => ({
                id: entry.id,
                kind: 'subscribe',
                topic: entry.topic,
              })),
            }),
            method: 'POST',
          });
          for (const entry of batch) {
            entry.resolve();
          }
        });
      });
    source.addEventListener('message', (event) => {
      const data = JSON.parse(String((event as MessageEvent).data));
      const subscription = subscriptions.get(data.subscriptionId);
      if (subscription && subscription.topic === data.topic) {
        subscription.onEvent?.(data);
      }
    });

    return {
      async subscribe({ id, onEvent, topic }) {
        subscriptions.set(id, { onEvent, topic });
        await open;
        await enqueue(id, topic);
        return async () => {
          subscriptions.delete(id);
          await fetch(String(url), {
            body: JSON.stringify({
              connectionId,
              operations: [{ id, kind: 'unsubscribe' }],
            }),
            method: 'POST',
          });
          source.close();
        };
      },
    };
  }) satisfies TestLiveConnector;

const openLiveStream = async () => {
  await vi.waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
  const source = MockEventSource.instances[0]!;
  source.emit('open');
  return source;
};

test('batches native HTTP operations in the same microtask', async () => {
  const fetch = vi.fn(async () =>
    jsonResponse({
      results: [
        { data: [{ id: '1' }], id: '1', ok: true },
        {
          data: {
            items: [],
            pagination: { hasNext: false, hasPrevious: false },
          },
          id: '2',
          ok: true,
        },
      ],
      version: 1,
    }),
  );
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    fetch,
    url: '/fate',
  });

  await Promise.all([
    transport.fetchById('Post', ['1'], new Set(['id'])),
    transport.fetchList?.('posts', new Set(['id'])),
  ]);

  expect(fetch).toHaveBeenCalledTimes(1);
  const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
  expect(JSON.parse((calls[0]?.[1].body as string) ?? '{}')).toEqual({
    operations: [
      {
        id: '1',
        ids: ['1'],
        kind: 'byId',
        select: ['id'],
        type: 'Post',
      },
      {
        id: '2',
        kind: 'list',
        name: 'posts',
        select: ['id'],
      },
    ],
    version: 1,
  });
});

test('normalizes native HTTP custom headers', async () => {
  const headers = await requestHeadersFor(
    () =>
      new Headers([
        ['authorization', 'Bearer apple'],
        ['x-session', 'banana'],
      ]),
  );

  expect(headers.get('authorization')).toBe('Bearer apple');
  expect(headers.get('content-type')).toBe('application/json');
  expect(headers.get('x-session')).toBe('banana');
});

test('normalizes tuple array headers for native HTTP requests', async () => {
  const headers = await requestHeadersFor([['authorization', 'Bearer apple']]);

  expect(headers.get('authorization')).toBe('Bearer apple');
});

test('raises protocol errors from failed operation results', async () => {
  const fetch = vi.fn(async () =>
    jsonResponse({
      results: [
        {
          error: { code: 'NOT_FOUND', message: 'Missing.' },
          id: '1',
          ok: false,
        },
      ],
      version: 1,
    }),
  );
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    fetch,
    url: '/fate',
  });

  await expect(transport.fetchQuery?.('viewer', new Set(['id']))).rejects.toThrowError('Missing.');
});

test('omits native SSE live support when disabled', () => {
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    live: false,
    url: '/fate',
  });

  expect(transport.subscribeById).toBeUndefined();
});

test('handles named native SSE live entity events emitted by the server', async () => {
  const fetch = vi.fn(async () =>
    jsonResponse({
      results: [{ data: null, id: '1', ok: true }],
      version: 1,
    }),
  );
  const onData = vi.fn();
  const onDelete = vi.fn();
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    eventSource: resetMockEventSource(),
    fetch,
    url: 'http://local/fate',
  });

  const dispose = transport.subscribeById?.('Post', '1', new Set(['id', 'title']), undefined, {
    onData,
    onDelete,
  });

  const source = await openLiveStream();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const postCall = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(postCall[0]).toBe('http://local/fate/live');
  expect(JSON.parse(String(postCall[1].body ?? '{}'))).toEqual({
    connectionId: expect.any(String),
    operations: [
      {
        entityId: '1',
        id: '1',
        kind: 'subscribe',
        select: ['id', 'title'],
        type: 'Post',
      },
    ],
    version: 1,
  });

  source.message(
    {
      event: { data: { id: '1', title: 'One' }, select: ['id', 'title'], type: 'update' },
      id: '1',
      kind: 'next',
    },
    'next',
  );
  source.message(
    {
      event: { delete: true, id: '1', type: 'delete' },
      id: '1',
      kind: 'next',
    },
    'next',
  );

  expect(onData).toHaveBeenCalledWith({ id: '1', title: 'One' }, ['id', 'title']);
  expect(onDelete).toHaveBeenCalledWith('1');
  dispose?.();
});

test('subscribes after the native SSE stream recovers from an initial error', async () => {
  const fetch = liveControlFetch();
  const transport = createHTTPTransport({
    eventSource: resetMockEventSource(),
    fetch,
    url: 'http://local/fate',
  });
  const handlers = { onData: vi.fn(), onError: vi.fn() };
  const dispose = transport.subscribeById!('Post', '1', new Set(['id']), undefined, handlers);
  const source = MockEventSource.instances[0]!;
  try {
    source.emit('error');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();

    source.emit('open');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, init] = fetch.mock.calls[0]!;
    expect(JSON.parse(String(init?.body)).operations).toEqual([
      { entityId: '1', id: '1', kind: 'subscribe', select: ['id'], type: 'Post' },
    ]);
    source.message({ event: { data: { id: '1' } }, id: '1', kind: 'next' }, 'next');
    expect(handlers.onData).toHaveBeenCalledWith({ id: '1' });
  } finally {
    dispose();
  }
  expect(source.closed).toBe(true);
});

test('closes the native SSE stream without unsubscribing from a closed connection', async () => {
  const fetch = vi.fn(async () =>
    jsonResponse({
      results: [{ data: null, id: '1', ok: true }],
      version: 1,
    }),
  );
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    eventSource: resetMockEventSource(),
    fetch,
    url: 'http://local/fate',
  });
  const handlers = { onData: vi.fn(), onError: vi.fn() };

  const disposeA = transport.subscribeById?.('Post', '1', new Set(['id']), undefined, handlers);
  const disposeB = transport.subscribeById?.('Post', '2', new Set(['id']), undefined, handlers);
  const source = await openLiveStream();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

  const operations = () =>
    (fetch.mock.calls as unknown as Array<[string, RequestInit]>).flatMap(
      ([, init]) => JSON.parse(String(init.body)).operations,
    );

  disposeA?.();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(operations()[2]).toMatchObject({ kind: 'unsubscribe' });
  expect(source.closed).toBe(false);

  // Removing the last subscription closes the stream, which ends every
  // subscription on the server; the connection is gone for later requests.
  disposeB?.();
  expect(source.closed).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(handlers.onError).not.toHaveBeenCalled();

  // Disposing two subscriptions in the same tick closes the stream too.
  const disposeC = transport.subscribeById?.('Post', '3', new Set(['id']), undefined, handlers);
  const disposeD = transport.subscribeById?.('Post', '4', new Set(['id']), undefined, handlers);
  await vi.waitFor(() => expect(MockEventSource.instances).toHaveLength(2));
  MockEventSource.instances[1]!.emit('open');
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
  disposeC?.();
  disposeD?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(MockEventSource.instances[1]!.closed).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(5);
  expect(handlers.onError).not.toHaveBeenCalled();
});

test.each(['subscribe', 'unsubscribe', 'reconnect'] as const)(
  'skips native %s requests when the stream closes while headers resolve',
  async (operation) => {
    const pendingHeaders = Promise.withResolvers<HeadersInit>();
    const headers = vi.fn<() => HeadersInit | Promise<HeadersInit>>(() => ({}));
    const fetch = liveControlFetch();
    const transport = createHTTPTransport({
      eventSource: resetMockEventSource(),
      fetch,
      headers,
      url: 'http://local/fate',
    });
    const handlers = { onData: vi.fn(), onError: vi.fn() };
    const disposeA = transport.subscribeById?.('Post', '1', new Set(['id']), undefined, handlers);
    const disposeB = transport.subscribeById?.('Post', '2', new Set(['id']), undefined, handlers);
    const source = await openLiveStream();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    headers.mockImplementationOnce(() => pendingHeaders.promise);
    let disposeC: (() => void) | undefined;
    if (operation === 'subscribe') {
      disposeC = transport.subscribeById?.('Post', '3', new Set(['id']), undefined, handlers);
    } else if (operation === 'unsubscribe') {
      disposeA?.();
    } else {
      source.emit('open');
    }
    await vi.waitFor(() => expect(headers).toHaveBeenCalledTimes(3));

    disposeA?.();
    disposeB?.();
    disposeC?.();
    expect(source.closed).toBe(true);
    pendingHeaders.resolve({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(handlers.onError).not.toHaveBeenCalled();

    const disposeNext = transport.subscribeById?.(
      'Post',
      '4',
      new Set(['id']),
      undefined,
      handlers,
    );
    MockEventSource.instances[1]!.emit('open');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(MockEventSource.instances[1]!.closed).toBe(false);
    disposeNext?.();
  },
);

test.each([
  { closed: false, failure: 'response' },
  { closed: false, failure: 'network' },
  { closed: true, failure: 'response' },
  { closed: true, failure: 'network' },
] as const)(
  'handles native control $failure failures with closed=$closed',
  async ({ closed, failure }) => {
    const pendingResponse = Promise.withResolvers<Response>();
    const fetch = liveControlFetch();
    const transport = createHTTPTransport({
      eventSource: resetMockEventSource(),
      fetch,
      url: 'http://local/fate',
    });
    const handlers = { onData: vi.fn(), onError: vi.fn() };
    const disposeA = transport.subscribeById?.('Post', '1', new Set(['id']), undefined, handlers);
    const disposeB = transport.subscribeById?.('Post', '2', new Set(['id']), undefined, handlers);
    const source = await openLiveStream();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    fetch.mockImplementationOnce(() => pendingResponse.promise);
    disposeA?.();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    if (closed) {
      disposeB?.();
    }
    expect(source.closed).toBe(closed);

    const nextHandlers = { onData: vi.fn(), onError: vi.fn() };
    const disposeNext = transport.subscribeById?.(
      'Post',
      '3',
      new Set(['id']),
      undefined,
      nextHandlers,
    );
    if (closed) {
      MockEventSource.instances[1]!.emit('open');
    }
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));

    const message = 'Live connection not found.';
    if (failure === 'response') {
      pendingResponse.resolve(new Response(message, { status: 404 }));
    } else {
      pendingResponse.reject(new Error(message));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (closed) {
      expect(handlers.onError).not.toHaveBeenCalled();
      expect(nextHandlers.onError).not.toHaveBeenCalled();
    } else {
      await vi.waitFor(() => expect(nextHandlers.onError).toHaveBeenCalledTimes(1));
      expect(handlers.onError).toHaveBeenCalledTimes(1);
      expect(nextHandlers.onError).toHaveBeenCalledWith(expect.objectContaining({ message }));
    }
    disposeB?.();
    disposeNext?.();
  },
);

test('handles named native SSE live connection events emitted by the server', async () => {
  const fetch = vi.fn(async () =>
    jsonResponse({
      results: [{ data: null, id: '1', ok: true }],
      version: 1,
    }),
  );
  const onEvent = vi.fn();
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    eventSource: resetMockEventSource(),
    fetch,
    live: true,
    url: 'http://local/fate',
  });

  const dispose = transport.subscribeConnection?.(
    'posts',
    'Post',
    { categoryId: 'fruit' },
    new Set(['id', 'title']),
    undefined,
    { onEvent },
  );

  const source = await openLiveStream();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const postCall = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(String(postCall[1].body ?? '{}')).operations).toEqual([
    {
      args: { categoryId: 'fruit' },
      id: '1',
      kind: 'subscribeConnection',
      procedure: 'posts',
      select: ['id', 'title'],
      type: 'Post',
    },
  ]);

  source.message(
    {
      event: {
        edge: {
          cursor: 'cursor-1',
          node: { id: '1', title: 'One' },
        },
        nodeType: 'Post',
        type: 'appendEdge',
      },
      id: '1',
      kind: 'connection',
    },
    'connection',
  );

  expect(onEvent).toHaveBeenCalledWith({
    edge: {
      cursor: 'cursor-1',
      node: { id: '1', title: 'One' },
    },
    nodeType: 'Post',
    type: 'appendEdge',
  });
  dispose?.();
});

test('handles named native SSE protocol errors emitted by the server', async () => {
  const fetch = vi.fn(async () =>
    jsonResponse({
      results: [{ data: null, id: '1', ok: true }],
      version: 1,
    }),
  );
  const onError = vi.fn();
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    eventSource: resetMockEventSource(),
    fetch,
    url: 'http://local/fate',
  });

  const dispose = transport.subscribeById?.('Post', '1', new Set(['id']), undefined, {
    onData: vi.fn(),
    onError,
  });

  const source = await openLiveStream();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

  source.message(
    {
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid live subscription.',
      },
      id: '1',
      kind: 'error',
    },
    'error',
  );

  expect(onError).toHaveBeenCalledWith(
    expect.objectContaining({
      code: 'BAD_REQUEST',
      message: 'Invalid live subscription.',
    }),
  );
  dispose?.();
});

test('subscribes to live connector entity topics', async () => {
  const fetch = liveControlFetch();
  const onData = vi.fn();
  const onDelete = vi.fn();
  const topic = liveEntityTopic('Post', '1');
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    eventSource: resetMockEventSource(),
    fetch,
    live: liveConnector(),
    url: 'http://local/fate',
  });

  const dispose = transport.subscribeById?.('Post', '1', new Set(['id', 'title']), undefined, {
    onData,
    onDelete,
  });

  const source = await openLiveStream();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
  expect(JSON.parse(String(calls[0]?.[1].body ?? '{}')).operations).toEqual([
    { id: '1', kind: 'subscribe', topic },
  ]);

  source.message({
    data: { data: { id: '1', title: 'One' }, id: '1' },
    subscriptionId: '1',
    topic,
    type: 'update',
  });
  source.message({
    data: { id: '1' },
    subscriptionId: '1',
    topic,
    type: 'delete',
  });

  expect(onData).toHaveBeenCalledWith({ id: '1', title: 'One' });
  expect(onDelete).toHaveBeenCalledWith('1');
  dispose?.();
});

test('subscribes to live connector connection topics', async () => {
  const fetch = liveControlFetch();
  const onEvent = vi.fn();
  const specificTopic = liveConnectionTopic('posts', { categoryId: 'fruit' });
  const globalTopic = liveGlobalConnectionTopic('posts');
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    eventSource: resetMockEventSource(),
    fetch,
    live: liveConnector(),
    url: 'http://local/fate',
  });

  const dispose = transport.subscribeConnection?.(
    'posts',
    'Post',
    { categoryId: 'fruit' },
    new Set(['id', 'title']),
    undefined,
    { onEvent },
  );

  const source = await openLiveStream();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const postCall = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(String(postCall[1].body ?? '{}')).operations).toEqual([
    { id: '1', kind: 'subscribe', topic: specificTopic },
    { id: '1:global', kind: 'subscribe', topic: globalTopic },
  ]);

  source.message({
    data: {
      cursor: 'cursor-1',
      id: '1',
      node: { id: '1', title: 'One' },
      nodeType: 'Post',
    },
    subscriptionId: '1',
    topic: specificTopic,
    type: 'appendEdge',
  });
  source.message({
    data: { id: '1', nodeType: 'Post' },
    subscriptionId: '1',
    topic: specificTopic,
    type: 'deleteEdge',
  });

  expect(onEvent).toHaveBeenCalledWith({
    edge: {
      cursor: 'cursor-1',
      node: { id: '1', title: 'One' },
    },
    nodeType: 'Post',
    type: 'appendEdge',
  });
  expect(onEvent).toHaveBeenCalledWith({ id: '1', nodeType: 'Post', type: 'deleteEdge' });

  dispose?.();
});

test.each(['delete', 'dispose'] as const)(
  'handles %s while fetching the record for a live connection insert',
  async (action) => {
    const pending = Promise.withResolvers<Response>();
    const fetch = liveControlFetch();
    const onEvent = vi.fn();
    const transport = createHTTPTransport({
      eventSource: resetMockEventSource(),
      fetch,
      live: liveConnector(),
      url: 'http://local/fate',
    });
    const dispose = transport.subscribeConnection!(
      'posts',
      'Post',
      undefined,
      new Set(['id']),
      undefined,
      { onEvent },
    );
    const source = await openLiveStream();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const topic = liveConnectionTopic('posts');
    const event = { data: { id: 'post-1', nodeType: 'Post' }, subscriptionId: '1', topic };

    try {
      fetch.mockReturnValueOnce(pending.promise);
      source.message({ ...event, type: 'appendNode' });
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      if (action === 'delete') {
        source.message({ ...event, type: 'deleteEdge' });
      } else {
        dispose();
      }
      pending.resolve(
        jsonResponse({ results: [{ data: [{ id: 'post-1' }], id: '1', ok: true }], version: 1 }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      if (action === 'delete') {
        expect(onEvent.mock.calls).toEqual([
          [{ edge: { node: { id: 'post-1' } }, nodeType: 'Post', type: 'appendNode' }],
          [{ id: 'post-1', nodeType: 'Post', type: 'deleteEdge' }],
        ]);
      } else {
        expect(onEvent).not.toHaveBeenCalled();
      }
    } finally {
      dispose();
    }
  },
);

test('uses the live event node type to fetch connection records without data', async () => {
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (String(input) === 'http://local/fate/live') {
      return jsonResponse({
        accepted: true,
        connectionId: body.connectionId,
        results: body.operations.map((operation: { id: string; kind: 'subscribe' }) => ({
          id: operation.id,
          kind: operation.kind,
          ok: true,
        })),
      });
    }

    return jsonResponse({
      results: [
        {
          data: [{ id: 'comment-1', title: 'Fetched' }],
          id: body.operations[0].id,
          ok: true,
        },
      ],
      version: 1,
    });
  });
  const onEvent = vi.fn();
  const args = { id: 'post-1' };
  const topic = liveConnectionTopic('Post.comments', args);
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    eventSource: resetMockEventSource(),
    fetch,
    live: liveConnector(),
    url: 'http://local/fate',
  });

  const dispose = transport.subscribeConnection?.(
    'Post.comments',
    '',
    args,
    new Set(['id', 'title']),
    undefined,
    { onEvent },
  );

  const source = await openLiveStream();
  source.message({
    data: { id: 'comment-1', nodeType: 'Comment' },
    subscriptionId: '1',
    topic,
    type: 'appendNode',
  });

  await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1));
  const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
  const byIdCall = calls.find(([input]) => input === 'http://local/fate');
  const operation = JSON.parse(String(byIdCall?.[1].body ?? '{}')).operations[0];

  expect(operation.type).toBe('Comment');
  expect(onEvent).toHaveBeenCalledWith({
    edge: {
      node: { id: 'comment-1', title: 'Fetched' },
    },
    nodeType: 'Comment',
    type: 'appendNode',
  });
  dispose?.();
});

test('reports live connector connection errors once per subscription', async () => {
  const fetch = liveControlFetch();
  const onError = vi.fn();
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    eventSource: resetMockEventSource(),
    fetch,
    live: liveConnector(),
    url: 'http://local/fate',
  });

  const dispose = transport.subscribeConnection?.(
    'posts',
    'Post',
    { categoryId: 'fruit' },
    new Set(['id']),
    undefined,
    { onError, onEvent: vi.fn() },
  );

  const source = await openLiveStream();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  source.emit('error');

  expect(onError).toHaveBeenCalledTimes(1);
  dispose?.();
});

test('fetches entity records for live connector events without data', async () => {
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (String(input) === 'http://local/fate/live') {
      return jsonResponse({
        accepted: true,
        connectionId: body.connectionId,
        results: body.operations.map((operation: { id: string; kind: 'subscribe' }) => ({
          id: operation.id,
          kind: operation.kind,
          ok: true,
        })),
      });
    }

    return jsonResponse({
      results: [{ data: [{ id: '1', title: 'Fetched' }], id: body.operations[0].id, ok: true }],
      version: 1,
    });
  });
  const onData = vi.fn();
  const topic = liveEntityTopic('Post', '1');
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    eventSource: resetMockEventSource(),
    fetch,
    live: liveConnector(),
    url: 'http://local/fate',
  });

  const dispose = transport.subscribeById?.('Post', '1', new Set(['id']), undefined, {
    onData,
  });

  const source = await openLiveStream();
  source.message({
    data: { id: '1' },
    subscriptionId: '1',
    topic,
    type: 'update',
  });

  await vi.waitFor(() => expect(onData).toHaveBeenCalledWith({ id: '1', title: 'Fetched' }));
  dispose?.();
});

test('delivers live entity updates in event order when a read is delayed', async () => {
  const older = Promise.withResolvers<Response>();
  const fetch = liveControlFetch();
  const onData = vi.fn();
  const transport = createHTTPTransport({
    eventSource: resetMockEventSource(),
    fetch,
    live: liveConnector(),
    url: 'http://local/fate',
  });
  const dispose = transport.subscribeById!('Post', '1', ['title'], undefined, { onData });
  const source = await openLiveStream();
  const event = {
    data: { changed: ['title'], id: '1' },
    subscriptionId: '1',
    topic: liveEntityTopic('Post', '1'),
    type: 'update',
  };
  const reply = (id: string, title: string) =>
    jsonResponse({
      results: [{ data: [{ id: event.data.id, title }], id, ok: true }],
      version: 1,
    });

  try {
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    fetch.mockReturnValueOnce(older.promise).mockResolvedValueOnce(reply('2', 'Newer'));
    source.message(event);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    source.message(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    older.resolve(reply('1', 'Older'));
    await vi.waitFor(() => expect(onData).toHaveBeenCalledTimes(2));
    expect(onData.mock.calls).toEqual([
      [{ id: '1', title: 'Older' }, ['title', 'id']],
      [{ id: '1', title: 'Newer' }, ['title', 'id']],
    ]);
  } finally {
    dispose();
  }
});

test.each(['delete', 'dispose'] as const)(
  'ignores a pending live entity fetch after %s',
  async (action) => {
    const pending = Promise.withResolvers<Response>();
    const fetch = liveControlFetch();
    const onData = vi.fn();
    const onDelete = vi.fn();
    const transport = createHTTPTransport({
      eventSource: resetMockEventSource(),
      fetch,
      live: liveConnector(),
      url: 'http://local/fate',
    });
    const dispose = transport.subscribeById!('Post', '1', ['title'], undefined, {
      onData,
      onDelete,
    });
    const source = await openLiveStream();
    const event = { data: { id: '1' }, subscriptionId: '1', topic: liveEntityTopic('Post', '1') };

    try {
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      fetch.mockReturnValueOnce(pending.promise);
      source.message({ ...event, type: 'update' });
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      if (action === 'delete') {
        source.message({ ...event, type: 'delete' });
        expect(onDelete).toHaveBeenCalledExactlyOnceWith('1');
      } else {
        dispose();
      }

      pending.resolve(
        jsonResponse({
          results: [{ data: [{ id: '1', title: 'Old' }], id: '1', ok: true }],
          version: 1,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onData).not.toHaveBeenCalled();

      if (action === 'delete') {
        source.message({ ...event, data: { data: { id: '1', title: 'New' } }, type: 'update' });
        expect(onData).toHaveBeenCalledExactlyOnceWith({ id: '1', title: 'New' });
      }
    } finally {
      dispose();
    }
  },
);

test('fetches only changed selected paths for live connector events', async () => {
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (String(input) === 'http://local/fate/live') {
      return jsonResponse({
        accepted: true,
        connectionId: body.connectionId,
        results: body.operations.map((operation: { id: string; kind: 'subscribe' }) => ({
          id: operation.id,
          kind: operation.kind,
          ok: true,
        })),
      });
    }

    return jsonResponse({
      results: [
        { data: [{ id: '1', likes: 5, title: 'Fetched' }], id: body.operations[0].id, ok: true },
      ],
      version: 1,
    });
  });
  const onData = vi.fn();
  const topic = liveEntityTopic('Post', '1');
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    eventSource: resetMockEventSource(),
    fetch,
    live: liveConnector(),
    url: 'http://local/fate',
  });

  const dispose = transport.subscribeById?.(
    'Post',
    '1',
    new Set(['id', 'title', 'likes']),
    undefined,
    {
      onData,
    },
  );

  const source = await openLiveStream();
  source.message({
    data: { changed: ['likes'], id: '1' },
    subscriptionId: '1',
    topic,
    type: 'update',
  });

  await vi.waitFor(() =>
    expect(onData).toHaveBeenCalledWith({ id: '1', likes: 5, title: 'Fetched' }, ['likes', 'id']),
  );
  const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
  const byIdCall = calls.find(([input]) => input === 'http://local/fate');
  expect(JSON.parse(String(byIdCall?.[1].body ?? '{}')).operations[0].select).toEqual([
    'likes',
    'id',
  ]);
  dispose?.();
});

test('passes live URL query params to the live connector EventSource', async () => {
  const fetch = liveControlFetch();
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    eventSource: resetMockEventSource(),
    fetch,
    live: liveConnector(),
    liveUrl: 'http://local/fate/live?token=apple',
    url: 'http://local/fate',
  });

  const dispose = transport.subscribeById?.('Post', '1', new Set(['id']), undefined, {
    onData: vi.fn(),
  });
  await openLiveStream();
  dispose?.();

  expect(MockEventSource.instances[0]?.url).toMatch(
    /^http:\/\/local\/fate\/live\?token=apple&connectionId=/,
  );
  expect(MockEventSource.instances[0]?.options).toEqual({ withCredentials: true });
});

test('invalidates mixed lists on live connector membership events', async () => {
  const fetch = liveControlFetch();
  const onEvent = vi.fn();
  const transport = createHTTPTransport({
    eventSource: resetMockEventSource(),
    fetch,
    live: liveConnector(),
    mixedLists: ['feed'],
    url: 'http://local/fate',
  });
  const dispose = transport.subscribeConnection!(
    'feed',
    'FeedItem',
    undefined,
    ['fate_type_4_Post_title:title:Post'],
    undefined,
    { onEvent },
  );
  try {
    const source = await openLiveStream();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    source.message({
      data: { id: 'post', nodeType: 'Post' },
      subscriptionId: '1:global',
      topic: liveGlobalConnectionTopic('feed'),
      type: 'appendNode',
    });

    expect(onEvent).toHaveBeenCalledExactlyOnceWith({ type: 'invalidate' });
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    dispose();
  }
});

test.each(['scoped', 'global'])(
  'cleans up the live topic when %s registration fails',
  async (failure) => {
    const pending = Promise.withResolvers<() => void>();
    const stop = vi.fn();
    const onError = vi.fn();
    const error = new Error('Could not register topic');
    const transport = createHTTPTransport({
      live: () => ({
        subscribe: ({ id }) =>
          id.endsWith(':global') === (failure === 'global')
            ? Promise.reject(error)
            : pending.promise,
      }),
      url: 'http://local/fate',
    });

    const dispose = transport.subscribeConnection!('posts', 'Post', {}, ['id'], undefined, {
      onError,
      onEvent: vi.fn(),
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    pending.resolve(stop);
    dispose();
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
  },
);
