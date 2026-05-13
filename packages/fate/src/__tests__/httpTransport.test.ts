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

  message(data: unknown) {
    this.emit('message', { data: JSON.stringify(data) } as MessageEvent);
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

test('supports native SSE live subscriptions by default', async () => {
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

  source.message({
    event: { data: { id: '1', title: 'One' }, type: 'update' },
    id: '1',
    kind: 'next',
  });
  source.message({
    event: { delete: true, id: '1', type: 'delete' },
    id: '1',
    kind: 'next',
  });

  expect(onData).toHaveBeenCalledWith({ id: '1', title: 'One' });
  expect(onDelete).toHaveBeenCalledWith('1');
  dispose?.();
});

test('supports native SSE live connection subscriptions', async () => {
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

  source.message({
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
  });

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
