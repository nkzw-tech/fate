import { expect, test, vi } from 'vite-plus/test';
import { createTRPCTransport } from '../transport.ts';

test('passes selection when fetching by id', async () => {
  const call = vi.fn(async () => []);
  const byIdResolver = vi.fn(() => call);
  const client = {} as any;

  const transport = createTRPCTransport({
    byId: {
      Post: byIdResolver,
    },
    client,
  });

  await transport.fetchById('Post', ['post-1'], new Set(['content', 'author.id']));

  expect(byIdResolver).toHaveBeenCalledWith(client);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith({
    args: undefined,
    ids: ['post-1'],
    select: ['content', 'author.id'],
  });
});

test('throws when fetching by id with unknown entity type', async () => {
  const transport = createTRPCTransport({
    byId: {},
    client: {} as any,
  });

  await expect(
    transport.fetchById('Post', ['post-1'], new Set(['content', 'author.id'])),
  ).rejects.toThrowError("fate(trpc): No 'byId' resolver configured for entity type 'Post'.");
});

test('passes selection when fetching lists', async () => {
  const call = vi.fn(async () => ({
    items: [],
    pagination: { hasNext: false, hasPrevious: false },
  }));
  const listResolver = vi.fn(() => call);
  const client = {} as any;

  const transport = createTRPCTransport({
    byId: {
      Post: vi.fn(() => vi.fn(async () => [])),
    },
    client,
    lists: {
      'post.all': listResolver,
    },
  });

  await transport.fetchList?.('post.all', new Set(['id', 'content']), {
    filter: 'recent',
  });

  expect(listResolver).toHaveBeenCalledWith(client);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith({
    args: { filter: 'recent' },
    select: ['id', 'content'],
  });
});

test('throws when fetching lists without configured resolvers', async () => {
  const transport = createTRPCTransport({
    byId: {
      Post: vi.fn(() => vi.fn(async () => [])),
    },
    client: {} as any,
  });

  await expect(transport.fetchList?.('post.all', new Set(['id']))).rejects.toThrowError(
    'fate(trpc): No list resolvers configured; cannot call "post.all".',
  );
});

test('throws when fetching lists with missing resolver', async () => {
  const transport = createTRPCTransport({
    byId: {
      Post: vi.fn(() => vi.fn(async () => [])),
    },
    client: {} as any,
    lists: {},
  });

  await expect(transport.fetchList?.('post.all', new Set(['id']))).rejects.toThrowError(
    'fate(trpc): Missing list resolver for procedure "post.all"',
  );
});

test('omits args when none are provided for lists', async () => {
  const call = vi.fn(async () => ({
    items: [],
    pagination: { hasNext: false, hasPrevious: false },
  }));
  const listResolver = vi.fn(() => call);
  const client = {} as any;

  const transport = createTRPCTransport({
    byId: {
      Post: vi.fn(() => vi.fn(async () => [])),
    },
    client,
    lists: {
      'post.all': listResolver,
    },
  });

  await transport.fetchList?.('post.all', new Set(['id', 'content']));

  expect(listResolver).toHaveBeenCalledWith(client);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith({
    args: undefined,
    select: ['id', 'content'],
  });
});

test('passes selection when fetching queries', async () => {
  const call = vi.fn(async () => ({ id: 'user-1' }));
  const queryResolver = vi.fn(() => call);
  const client = {} as any;

  const transport = createTRPCTransport({
    byId: {
      Post: vi.fn(() => vi.fn(async () => [])),
    },
    client,
    queries: {
      viewer: queryResolver,
    },
  });

  await transport.fetchQuery?.('viewer', new Set(['id', 'name']), { greeting: 'hi' });

  expect(queryResolver).toHaveBeenCalledWith(client);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith({ args: { greeting: 'hi' }, select: ['id', 'name'] });
});

test('throws when fetching queries without configured resolvers', async () => {
  const transport = createTRPCTransport({
    byId: {
      Post: vi.fn(() => vi.fn(async () => [])),
    },
    client: {} as any,
  });

  await expect(transport.fetchQuery?.('viewer', new Set(['id']))).rejects.toThrowError(
    'fate(trpc): No query resolvers configured; cannot call "viewer".',
  );
});

test('passes selection when invoking mutations', async () => {
  const call = vi.fn(async () => ({ id: 'post-1' }));
  const mutationResolver = vi.fn(() => call);
  const client = {} as any;

  const transport = createTRPCTransport({
    byId: {
      Post: vi.fn(() => vi.fn(async () => [])),
    },
    client,
    mutations: {
      'post.create': mutationResolver,
    },
  });

  await transport.mutate?.(
    'post.create',
    { content: 'Kiwi', id: 'post-1' },
    new Set(['id', 'content']),
  );

  expect(mutationResolver).toHaveBeenCalledWith(client);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith({
    content: 'Kiwi',
    id: 'post-1',
    select: ['id', 'content'],
  });
});

test('throws when invoking missing mutation resolver', async () => {
  const transport = createTRPCTransport({
    byId: {
      Post: vi.fn(() => vi.fn(async () => [])),
    },
    client: {} as any,
  });

  await expect(
    // @ts-expect-error
    transport.mutate?.('post.create', { content: 'Kiwi' }, new Set(['id'])),
  ).rejects.toThrowError("fate(trpc): Missing mutation resolver for procedure 'post.create'.");
});

test('subscribes to live by-id updates', () => {
  const unsubscribe = vi.fn();
  let input: unknown;
  let handlers: any;
  const subscribe = vi.fn((nextInput, nextHandlers) => {
    input = nextInput;
    handlers = nextHandlers;
    return { unsubscribe };
  });
  const liveResolver = vi.fn(() => subscribe);
  const client = {} as any;
  const onData = vi.fn();
  const onDelete = vi.fn();
  const onError = vi.fn();

  const transport = createTRPCTransport({
    byId: {
      Post: vi.fn(() => vi.fn(async () => [])),
    },
    client,
    live: {
      byId: {
        Post: liveResolver,
      },
    },
  });

  const dispose = transport.subscribeById?.(
    'Post',
    'post-1',
    new Set(['id', 'content']),
    { comments: { first: 3 } },
    { onData, onDelete, onError },
  );

  expect(liveResolver).toHaveBeenCalledWith(client);
  expect(subscribe).toHaveBeenCalledTimes(1);
  expect(input).toEqual({
    args: { comments: { first: 3 } },
    id: 'post-1',
    select: ['id', 'content'],
  });

  handlers.onData({ data: { id: 'post-1' } });
  handlers.onData({ delete: true });
  handlers.onData({ data: { data: { id: 'post-2' } }, id: 'event-1' });
  handlers.onData({ data: { delete: true, id: 'post-2' }, id: 'event-2' });
  handlers.onError(new Error('boom'));

  expect(onData).toHaveBeenCalledWith({ id: 'post-1' });
  expect(onData).toHaveBeenCalledWith({ id: 'post-2' });
  expect(onDelete).toHaveBeenCalledWith('post-1');
  expect(onDelete).toHaveBeenCalledWith('post-2');
  expect(onError).toHaveBeenCalledWith(expect.any(Error));

  dispose?.();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test('passes raw live payloads as data', () => {
  let handlers: any;
  const subscribe = vi.fn((_input, nextHandlers) => {
    handlers = nextHandlers;
    return { unsubscribe: vi.fn() };
  });
  const onData = vi.fn();

  const transport = createTRPCTransport({
    byId: {
      Post: vi.fn(() => vi.fn(async () => [])),
    },
    client: {} as any,
    live: {
      byId: {
        Post: vi.fn(() => subscribe),
      },
    },
  });

  transport.subscribeById?.('Post', 'post-1', new Set(['id']), undefined, { onData });
  handlers.onData({ id: 'post-1' });

  expect(onData).toHaveBeenCalledWith({ id: 'post-1' });
});

test('throws when subscribing to a missing live resolver', () => {
  const transport = createTRPCTransport({
    byId: {
      Post: vi.fn(() => vi.fn(async () => [])),
    },
    client: {} as any,
    live: {
      byId: {},
    },
  });

  expect(() =>
    transport.subscribeById?.('Post', 'post-1', new Set(['id']), undefined, {
      onData: vi.fn(),
    }),
  ).toThrowError("fate(trpc): Missing live resolver for entity type 'Post'.");
});
