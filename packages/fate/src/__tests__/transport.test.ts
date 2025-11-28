import { expect, test, vi } from 'vitest';
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

  await transport.fetchById(
    'Post',
    ['post-1'],
    new Set(['content', 'author.id']),
  );

  expect(byIdResolver).toHaveBeenCalledWith(client);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith({
    args: undefined,
    ids: ['post-1'],
    select: ['content', 'author.id'],
  });
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
