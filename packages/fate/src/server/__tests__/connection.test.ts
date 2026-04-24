import { initTRPC } from '@trpc/server';
import { expect, test, vi } from 'vite-plus/test';
import { z } from 'zod';
import { arrayToConnection, withConnection } from '../connection.ts';

const t = initTRPC.create();

const router = t.router;
const procedure = t.procedure;

const createConnectionProcedure = withConnection(procedure);

test('allows nested connection args', async () => {
  const query = vi.fn(async () => [] as Array<unknown>);
  const list = createConnectionProcedure({ query });
  const appRouter = router({ list });
  const caller = appRouter.createCaller({
    headers: {},
    prisma: {} as never,
    sessionUser: null,
  });

  await expect(
    caller.list({
      args: { comments: { first: 2 } },
      select: [],
    }),
  ).resolves.toEqual({
    items: [],
    pagination: {
      hasNext: false,
      hasPrevious: false,
      nextCursor: undefined,
      previousCursor: undefined,
    },
  });

  expect(query).toHaveBeenCalledWith(
    expect.objectContaining({
      cursor: undefined,
      direction: 'forward',
      input: expect.objectContaining({
        args: { comments: { first: 2 } },
      }),
      skip: undefined,
      take: 21,
    }),
  );
});

test('merges additional input options', async () => {
  const query = vi.fn(async () => [] as Array<unknown>);
  const list = createConnectionProcedure({
    input: z.object({
      search: z.string().min(1, 'Search query is required'),
    }),
    query,
  });
  const appRouter = router({ list });
  const caller = appRouter.createCaller({
    headers: {},
    prisma: {} as never,
    sessionUser: null,
  });

  await expect(
    caller.list({
      args: { first: 1, search: 'comment' },
      select: [],
    }),
  ).resolves.toEqual({
    items: [],
    pagination: {
      hasNext: false,
      hasPrevious: false,
      nextCursor: undefined,
      previousCursor: undefined,
    },
  });

  expect(query).toHaveBeenCalledWith(
    expect.objectContaining({
      cursor: undefined,
      direction: 'forward',
      input: expect.objectContaining({
        args: { first: 1, search: 'comment' },
      }),
      skip: undefined,
      take: 2,
    }),
  );
});

test('allows initial backward pagination with last', async () => {
  const query = vi.fn(async () => [
    { id: 'comment-1' },
    { id: 'comment-2' },
    { id: 'comment-3' },
    { id: 'comment-4' },
  ]);
  const list = createConnectionProcedure({ query });
  const appRouter = router({ list });
  const caller = appRouter.createCaller({
    headers: {},
    prisma: {} as never,
    sessionUser: null,
  });

  await expect(
    caller.list({
      args: { last: 3 },
      select: [],
    }),
  ).resolves.toEqual({
    items: [
      { cursor: 'comment-2', node: { id: 'comment-2' } },
      { cursor: 'comment-3', node: { id: 'comment-3' } },
      { cursor: 'comment-4', node: { id: 'comment-4' } },
    ],
    pagination: {
      hasNext: false,
      hasPrevious: true,
      nextCursor: 'comment-4',
      previousCursor: 'comment-2',
    },
  });

  expect(query).toHaveBeenCalledWith(
    expect.objectContaining({
      cursor: undefined,
      direction: 'backward',
      skip: undefined,
      take: 4,
    }),
  );
});

test('derives pagination from provided args', () => {
  const result = arrayToConnection([{ id: 'comment-1' }, { id: 'comment-2' }], {
    args: { first: 1 },
  });

  expect(result).toEqual({
    items: [
      {
        cursor: 'comment-1',
        node: { id: 'comment-1' },
      },
    ],
    pagination: {
      hasNext: true,
      hasPrevious: false,
      nextCursor: 'comment-1',
      previousCursor: undefined,
    },
  });
});

test('paginates forward starting after the provided cursor', () => {
  const result = arrayToConnection(
    [
      { id: 'comment-1' },
      { id: 'comment-2' },
      { id: 'comment-3' },
      { id: 'comment-4' },
      { id: 'comment-5' },
    ],
    {
      args: { after: 'comment-2', first: 2 },
    },
  );

  expect(result).toEqual({
    items: [
      { cursor: 'comment-3', node: { id: 'comment-3' } },
      { cursor: 'comment-4', node: { id: 'comment-4' } },
    ],
    pagination: {
      hasNext: true,
      hasPrevious: true,
      nextCursor: 'comment-4',
      previousCursor: 'comment-3',
    },
  });
});

test('paginates backward stopping before the provided cursor', () => {
  const result = arrayToConnection(
    [
      { id: 'comment-1' },
      { id: 'comment-2' },
      { id: 'comment-3' },
      { id: 'comment-4' },
      { id: 'comment-5' },
    ],
    {
      args: { before: 'comment-4', last: 2 },
    },
  );

  expect(result).toEqual({
    items: [
      { cursor: 'comment-2', node: { id: 'comment-2' } },
      { cursor: 'comment-3', node: { id: 'comment-3' } },
    ],
    pagination: {
      hasNext: true,
      hasPrevious: true,
      nextCursor: 'comment-3',
      previousCursor: 'comment-2',
    },
  });
});
