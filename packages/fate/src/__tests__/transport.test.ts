import { expect, test, vi } from 'vitest';
import { createFateTransport } from '../transport.ts';

test('passes selection when fetching by id', async () => {
  const call = vi.fn(async () => []);
  const byIdResolver = vi.fn(() => call);
  const client = {} as any;

  const transport = createFateTransport({
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
    ids: ['post-1'],
    select: ['content', 'author.id'],
  });
});

test('passes selection when fetching lists', async () => {
  const call = vi.fn(async () => ({
    edges: [],
    pageInfo: { hasNextPage: false },
  }));
  const listResolver = vi.fn(() => call);
  const client = {} as any;

  const transport = createFateTransport({
    byId: {
      Post: vi.fn(() => vi.fn(async () => [])),
    },
    client,
    lists: {
      'post.all': listResolver,
    },
  });

  await transport.fetchList?.(
    'post.all',
    { filter: 'recent' },
    new Set(['id', 'content']),
  );

  expect(listResolver).toHaveBeenCalledWith(client);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith({
    filter: 'recent',
    select: ['id', 'content'],
  });
});

test('passes selection when invoking mutations', async () => {
  const call = vi.fn(async () => ({ id: 'post-1' }));
  const mutationResolver = vi.fn(() => call);
  const client = {} as any;

  const transport = createFateTransport({
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
    { content: 'Hello', id: 'post-1' },
    new Set(['id', 'content']),
  );

  expect(mutationResolver).toHaveBeenCalledWith(client);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith({
    content: 'Hello',
    id: 'post-1',
    select: ['id', 'content'],
  });
});
