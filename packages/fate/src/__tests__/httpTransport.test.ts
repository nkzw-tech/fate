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
            'event: update',
            'data: {"data":{"id":"1","title":"One"}}',
            '',
            'event: delete',
            'data: {"delete":true,"id":"1"}',
            '',
            '',
          ].join('\n'),
        ),
      );
      controller.close();
    },
  });
  const fetch = vi.fn(async () => new Response(stream));
  const onData = vi.fn();
  const onDelete = vi.fn();
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    fetch,
    url: '/fate',
  });

  transport.subscribeById?.('Post', '1', new Set(['id', 'title']), undefined, {
    onData,
    onDelete,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(fetch).toHaveBeenCalledWith(
    '/fate/live',
    expect.objectContaining({
      method: 'POST',
    }),
  );
  expect(onData).toHaveBeenCalledWith({ id: '1', title: 'One' });
  expect(onDelete).toHaveBeenCalledWith('1');
});

test('reconnects native SSE live events with the last received event id', async () => {
  const firstStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          ['id: evt-1', 'event: update', 'data: {"data":{"id":"1","title":"One"}}', '', ''].join(
            '\n',
          ),
        ),
      );
      controller.close();
    },
  });
  const secondStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          ['event: update', 'data: {"data":{"id":"1","title":"Two"}}', '', ''].join('\n'),
        ),
      );
    },
  });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(firstStream))
    .mockResolvedValueOnce(new Response(secondStream));
  const onData = vi.fn();
  const transport = createHTTPTransport<{ mutations: Record<never, never> }>({
    fetch,
    liveRetryMs: 0,
    url: '/fate',
  });

  const dispose = transport.subscribeById?.('Post', '1', new Set(['id', 'title']), undefined, {
    onData,
  });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  dispose?.();

  const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
  expect(JSON.parse((calls[1]?.[1].body as string) ?? '{}')).toMatchObject({
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
