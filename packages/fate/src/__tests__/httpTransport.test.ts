import { expect, test, vi } from 'vite-plus/test';
import { createHTTPTransport } from '../httpTransport.ts';

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

test('subscribes to native SSE live events', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          [
            'id: evt-1',
            'event: next',
            'data: {"kind":"next","id":"1","event":{"data":{"id":"1","title":"One"}}}',
            '',
            'event: next',
            'data: {"kind":"next","id":"1","event":{"delete":true,"id":"1"}}',
            '',
            '',
          ].join('\n'),
        ),
      );
    },
  });
  const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
    init?.method === 'GET'
      ? new Response(stream)
      : jsonResponse({
          results: [{ data: null, id: '1', ok: true }],
          version: 1,
        }),
  );
  const onData = vi.fn();
  const onDelete = vi.fn();
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    fetch,
    url: '/fate',
  });

  const dispose = transport.subscribeById?.('Post', '1', new Set(['id', 'title']), undefined, {
    onData,
    onDelete,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
  expect(calls.filter(([, init]) => init.method === 'GET')).toHaveLength(1);
  expect(calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
  expect(onData).toHaveBeenCalledWith({ id: '1', title: 'One' });
  expect(onDelete).toHaveBeenCalledWith('1');
  dispose?.();
});

test('preserves native SSE live URL query params', async () => {
  const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
    init?.method === 'GET'
      ? new Response(new ReadableStream<Uint8Array>())
      : jsonResponse({
          results: [{ data: null, id: '1', ok: true }],
          version: 1,
        }),
  );
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    fetch,
    liveUrl: '/fate/live?token=apple',
    url: '/fate',
  });

  const dispose = transport.subscribeById?.('Post', '1', new Set(['id']), undefined, {
    onData: vi.fn(),
  });

  await vi.waitFor(() => {
    const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.find(([, init]) => init.method === 'GET')?.[0]).toMatch(
      /^\/fate\/live\?token=apple&connectionId=/,
    );
  });
  dispose?.();
});

test('retries failed native SSE live control operations while the stream stays open', async () => {
  const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'GET') {
      return new Response(new ReadableStream<Uint8Array>());
    }

    if (fetch.mock.calls.filter(([, callInit]) => callInit?.method === 'POST').length === 1) {
      return new Response('temporary', { status: 503 });
    }

    const body = JSON.parse(String(init?.body ?? '{}'));
    return jsonResponse({
      results: body.operations.map((operation: { id: string }) => ({
        data: null,
        id: operation.id,
        ok: true,
      })),
      version: 1,
    });
  });
  const onError = vi.fn();
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    fetch,
    liveRetryMs: 0,
    url: '/fate',
  });

  const dispose = transport.subscribeById?.('Post', '1', new Set(['id']), undefined, {
    onData: vi.fn(),
    onError,
  });

  await vi.waitFor(() => {
    const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.filter(([, init]) => init.method === 'GET')).toHaveLength(1);
    expect(calls.filter(([, init]) => init.method === 'POST')).toHaveLength(2);
  });

  const postBodies = (fetch.mock.calls as unknown as Array<[string, RequestInit]>)
    .filter(([, init]) => init.method === 'POST')
    .map(([, init]) => JSON.parse(String(init.body)));
  expect(postBodies[0].operations).toEqual(postBodies[1].operations);
  expect(onError).toHaveBeenCalledTimes(1);
  dispose?.();
});

test('resends native SSE live subscriptions after the initial stream setup retries', async () => {
  let streamRequests = 0;
  const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'GET') {
      streamRequests += 1;
      if (streamRequests === 1) {
        return new Response('temporary', { status: 500 });
      }

      return new Response(new ReadableStream<Uint8Array>());
    }

    const body = JSON.parse(String(init?.body ?? '{}'));
    return jsonResponse({
      results: body.operations.map((operation: { id: string }) => ({
        data: null,
        id: operation.id,
        ok: true,
      })),
      version: 1,
    });
  });
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    fetch,
    liveRetryMs: 0,
    url: '/fate',
  });

  const dispose = transport.subscribeById?.('Post', '1', new Set(['id', 'title']), undefined, {
    onData: vi.fn(),
  });

  await vi.waitFor(() => {
    const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.filter(([, init]) => init.method === 'GET')).toHaveLength(2);
    expect(calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
  });
  dispose?.();

  const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
  const postCall = calls.find(([, init]) => init.method === 'POST');
  expect(JSON.parse((postCall?.[1].body as string) ?? '{}').operations).toEqual([
    {
      entityId: '1',
      id: '1',
      kind: 'subscribe',
      select: ['id', 'title'],
      type: 'Post',
    },
  ]);
});

test('multiplexes native SSE live subscriptions over one stream', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          [
            'event: next',
            'data: {"kind":"next","id":"1","event":{"data":{"id":"1","title":"One"}}}',
            '',
            'event: next',
            'data: {"kind":"next","id":"2","event":{"data":{"id":"2","title":"Two"}}}',
            '',
            '',
          ].join('\n'),
        ),
      );
    },
  });
  const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
    init?.method === 'GET'
      ? new Response(stream)
      : jsonResponse({
          results: [
            { data: null, id: '1', ok: true },
            { data: null, id: '2', ok: true },
          ],
          version: 1,
        }),
  );
  const onPostOne = vi.fn();
  const onPostTwo = vi.fn();
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    fetch,
    url: '/fate',
  });

  const disposeOne = transport.subscribeById?.('Post', '1', new Set(['id', 'title']), undefined, {
    onData: onPostOne,
  });
  const disposeTwo = transport.subscribeById?.('Post', '2', new Set(['id', 'title']), undefined, {
    onData: onPostTwo,
  });

  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

  const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
  const postBody = JSON.parse(
    (calls.find(([, init]) => init.method === 'POST')?.[1].body as string) ?? '{}',
  );
  expect(calls.filter(([, init]) => init.method === 'GET')).toHaveLength(1);
  expect(postBody.operations).toHaveLength(2);
  expect(onPostOne).toHaveBeenCalledWith({ id: '1', title: 'One' });
  expect(onPostTwo).toHaveBeenCalledWith({ id: '2', title: 'Two' });
  disposeOne?.();
  disposeTwo?.();
});

test('reconnects native SSE live events with the last received event id', async () => {
  const firstStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          [
            'id: evt-1',
            'event: next',
            'data: {"kind":"next","id":"1","event":{"data":{"id":"1","title":"One"}}}',
            '',
            '',
          ].join('\n'),
        ),
      );
      controller.close();
    },
  });
  const secondStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          [
            'event: next',
            'data: {"kind":"next","id":"1","event":{"data":{"id":"1","title":"Two"}}}',
            '',
            '',
          ].join('\n'),
        ),
      );
    },
  });
  let streamCount = 0;
  const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'GET') {
      streamCount += 1;
      return new Response(streamCount === 1 ? firstStream : secondStream);
    }

    const body = JSON.parse(String(init?.body ?? '{}'));
    return jsonResponse({
      results: body.operations.map((operation: { id: string }) => ({
        data: null,
        id: operation.id,
        ok: true,
      })),
      version: 1,
    });
  });
  const onData = vi.fn();
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    fetch,
    liveRetryMs: 0,
    url: '/fate',
  });

  const dispose = transport.subscribeById?.('Post', '1', new Set(['id', 'title']), undefined, {
    onData,
  });
  await vi.waitFor(() => {
    const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.filter(([, init]) => init.method === 'GET')).toHaveLength(2);
    expect(calls.filter(([, init]) => init.method === 'POST')).toHaveLength(2);
  });
  dispose?.();

  const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
  const postCalls = calls.filter(([, init]) => init.method === 'POST');
  expect(JSON.parse((postCalls[1]?.[1].body as string) ?? '{}').operations[0]).toMatchObject({
    lastEventId: 'evt-1',
  });
  expect(onData).toHaveBeenCalledWith({ id: '1', title: 'One' });
  expect(onData).toHaveBeenCalledWith({ id: '1', title: 'Two' });
});

test('does not reconnect native SSE live events after permanent protocol errors', async () => {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              error: { code: 'NOT_FOUND', message: 'Live views are not enabled.' },
              id: 'live',
              ok: false,
            },
          ],
          version: 1,
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 404,
        },
      ),
  );
  const onError = vi.fn();
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    fetch,
    liveRetryMs: 0,
    url: '/fate',
  });

  transport.subscribeById?.('Post', '1', new Set(['id']), undefined, {
    onData: vi.fn(),
    onError,
  });
  await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(fetch).toHaveBeenCalledTimes(1);
});
