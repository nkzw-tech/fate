import { expect, test } from 'vite-plus/test';
import { z } from 'zod';
import type { AnyRecord } from '../../types.ts';
import { dataView, list } from '../dataView.ts';
import type { DataView } from '../dataView.ts';
import { createSourceRegistry } from '../executor.ts';
import { createFateFetchHandler, createFateServer, createHonoFateHandler } from '../http.ts';
import { createLiveEventBus } from '../live.ts';
import type { SourceDefinition } from '../source.ts';

type Post = {
  __typename: 'Post';
  id: string;
  likes: number;
  title: string;
};

type User = {
  __typename: 'User';
  id: string;
  name: string;
};

type TestContext = {
  request: Request;
  user: User;
};

const postView = dataView<Post>('Post')({
  id: true,
  likes: true,
  title: true,
});

const userView = dataView<User>('User')({
  id: true,
  name: true,
});

const posts: Array<Post> = [
  { __typename: 'Post', id: '1', likes: 0, title: 'One' },
  { __typename: 'Post', id: '2', likes: 1, title: 'Two' },
];

const postSource: SourceDefinition<Post> = {
  id: 'id',
  view: postView,
};

const userSource: SourceDefinition<User> = {
  id: 'id',
  view: userView,
};

const createServer = () => {
  const live = createLiveEventBus();
  const registry = createSourceRegistry([
    [
      postSource,
      {
        byIds: async ({ ids }) => posts.filter((post) => ids.includes(post.id)),
        connection: async ({ take }) => posts.slice(0, take),
      },
    ],
    [
      userSource,
      {
        byIds: async ({ ids }) =>
          ids.includes('u1') ? [{ __typename: 'User', id: 'u1', name: 'Ada' }] : [],
      },
    ],
  ]);
  const sourcesByType = new Map<string, SourceDefinition<AnyRecord>>([
    ['Post', postSource],
    ['User', userSource],
  ]);
  const sources = {
    getSource: <Item extends AnyRecord>(target: DataView<Item> | SourceDefinition<Item>) => {
      if ('view' in target && 'id' in target) {
        return target;
      }
      return sourcesByType.get(target.typeName)! as SourceDefinition<Item>;
    },
    registry,
  };

  const fate = createFateServer({
    context: ({ request }) => ({
      request,
      user: { __typename: 'User' as const, id: 'u1', name: 'Ada' },
    }),
    live,
    mutations: {
      'post.explode': {
        resolve: () => {
          throw new Error('database password leaked');
        },
        type: 'Post',
      },
      'post.like': {
        resolve: async ({ input, select }: { input: { id: string }; select: Array<string> }) => {
          const id = (input as { id: string }).id;
          const post = posts.find((entry) => entry.id === id);
          if (!post) {
            throw new Error('Post not found.');
          }
          post.likes += 1;
          expect(select).toContain('likes');
          return post;
        },
        type: 'Post',
      },
      'post.validate': {
        input: z.object({
          id: z.string(),
        }),
        resolve: ({ input }: { input: { id: string } }) =>
          posts.find((post) => post.id === input.id),
        type: 'Post',
      },
    },
    queries: {
      viewer: {
        resolve: ({ ctx }: { ctx: unknown }) => (ctx as TestContext).user,
      },
    },
    roots: {
      posts: list(postView),
      viewer: userView,
    },
    sources,
  });

  return { fate, live };
};

const postJSON = (url: string, body: unknown) =>
  new Request(url, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });

test('handles native batched operations', async () => {
  const { fate } = createServer();
  const response = await fate.handleRequest(
    postJSON('http://local/fate', {
      operations: [
        {
          id: '1',
          ids: ['1'],
          kind: 'byId',
          select: ['id', 'title'],
          type: 'Post',
        },
        {
          args: { first: 1 },
          id: '2',
          kind: 'list',
          name: 'posts',
          select: ['id', 'title'],
        },
        {
          id: '3',
          kind: 'query',
          name: 'viewer',
          select: ['id', 'name'],
        },
        {
          id: '4',
          input: { id: '1' },
          kind: 'mutation',
          name: 'post.like',
          select: ['id', 'likes'],
        },
      ],
      version: 1,
    }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    results: [
      { data: [{ id: '1', title: 'One' }], id: '1', ok: true },
      {
        data: {
          items: [{ cursor: '1', node: { id: '1', title: 'One' } }],
          pagination: { hasNext: true, hasPrevious: false, nextCursor: '1' },
        },
        id: '2',
        ok: true,
      },
      { data: { id: 'u1', name: 'Ada' }, id: '3', ok: true },
      { data: { id: '1', likes: 1 }, id: '4', ok: true },
    ],
    version: 1,
  });
});

test('returns per-operation protocol errors', async () => {
  const { fate } = createServer();
  const response = await fate.handleRequest(
    postJSON('http://local/fate', {
      operations: [
        {
          id: 'missing',
          kind: 'query',
          name: 'missing',
          select: [],
        },
      ],
      version: 1,
    }),
  );

  await expect(response.json()).resolves.toMatchObject({
    results: [
      {
        error: {
          code: 'NOT_FOUND',
          message: "No query registered for 'missing'.",
        },
        id: 'missing',
        ok: false,
      },
    ],
    version: 1,
  });
});

test('maps native mutation validation errors to protocol validation errors', async () => {
  const { fate } = createServer();
  const response = await fate.handleRequest(
    postJSON('http://local/fate', {
      operations: [
        {
          id: 'invalid-input',
          input: { id: 1 },
          kind: 'mutation',
          name: 'post.validate',
          select: ['id'],
        },
      ],
      version: 1,
    }),
  );

  await expect(response.json()).resolves.toMatchObject({
    results: [
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed.',
        },
        id: 'invalid-input',
        ok: false,
      },
    ],
    version: 1,
  });
});

test('sanitizes unexpected native operation errors', async () => {
  const { fate } = createServer();
  const response = await fate.handleRequest(
    postJSON('http://local/fate', {
      operations: [
        {
          id: 'explode',
          input: {},
          kind: 'mutation',
          name: 'post.explode',
          select: ['id'],
        },
      ],
      version: 1,
    }),
  );

  await expect(response.json()).resolves.toMatchObject({
    results: [
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error.',
        },
        id: 'explode',
        ok: false,
      },
    ],
    version: 1,
  });
});

test('rejects invalid native protocol operations before execution', async () => {
  const { fate } = createServer();
  const response = await fate.handleRequest(
    postJSON('http://local/fate', {
      operations: [
        {
          id: 'invalid',
          kind: 'unknown',
          name: 'post.like',
          select: ['id'],
        },
      ],
      version: 1,
    }),
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    results: [
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid Fate protocol operation.',
        },
        id: 'request',
        ok: false,
      },
    ],
    version: 1,
  });
});

test('rejects invalid native live requests before streaming', async () => {
  const { fate } = createServer();
  const response = await fate.handleLiveRequest(
    postJSON('http://local/fate/live', {
      id: '1',
      select: [1],
      type: 'Post',
      version: 1,
    }),
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    results: [
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid Fate live request.',
        },
        id: 'live',
        ok: false,
      },
    ],
    version: 1,
  });
});

test('streams live updates over SSE', async () => {
  const { fate, live } = createServer();
  const response = await fate.handleLiveRequest(
    new Request('http://local/fate/live?connectionId=c1'),
  );
  const reader = response.body!.getReader();
  await expect(
    fate.handleLiveRequest(
      postJSON('http://local/fate/live', {
        connectionId: 'c1',
        operations: [
          {
            entityId: '1',
            id: 'sub-1',
            kind: 'subscribe',
            select: ['id', 'title'],
            type: 'Post',
          },
        ],
        version: 1,
      }),
    ),
  ).resolves.toHaveProperty('status', 200);

  live.update('Post', '1', { eventId: 'evt-1' });
  await reader.read();
  const { value } = await reader.read();
  const chunk = new TextDecoder().decode(value);

  expect(chunk).toContain('id: evt-1');
  expect(chunk).toContain('event: next');
  expect(chunk).toContain('"id":"sub-1"');
  expect(chunk).toContain('"event":{"data":{"id":"1","title":"One"}}');
  await reader.cancel();
});

test('routes live updates only to matching subscriptions on one SSE stream', async () => {
  const { fate, live } = createServer();
  const response = await fate.handleLiveRequest(
    new Request('http://local/fate/live?connectionId=c1'),
  );
  const reader = response.body!.getReader();

  await fate.handleLiveRequest(
    postJSON('http://local/fate/live', {
      connectionId: 'c1',
      operations: [
        {
          entityId: '1',
          id: 'sub-1',
          kind: 'subscribe',
          select: ['id', 'title'],
          type: 'Post',
        },
        {
          entityId: '2',
          id: 'sub-2',
          kind: 'subscribe',
          select: ['id', 'title'],
          type: 'Post',
        },
      ],
      version: 1,
    }),
  );

  live.update('Post', '2', { eventId: 'evt-2' });
  await reader.read();
  const { value } = await reader.read();
  const chunk = new TextDecoder().decode(value);

  expect(chunk).toContain('"id":"sub-2"');
  expect(chunk).toContain('"event":{"data":{"id":"2","title":"Two"}}');
  expect(chunk).not.toContain('"id":"sub-1"');
  await reader.cancel();
});

test('creates fetch and Hono-compatible handlers', async () => {
  const { fate } = createServer();
  const fetchHandler = createFateFetchHandler(fate);
  const honoHandler = createHonoFateHandler(fate);
  const request = postJSON('http://local/fate', {
    operations: [{ id: '1', ids: ['1'], kind: 'byId', select: ['id'], type: 'Post' }],
    version: 1,
  });

  await expect(fetchHandler(request.clone())).resolves.toHaveProperty('status', 200);
  await expect(honoHandler({ req: { raw: request.clone() } })).resolves.toHaveProperty(
    'status',
    200,
  );
});

test('exposes a manifest for code generation', () => {
  const { fate } = createServer();

  expect(fate.manifest).toEqual({
    lists: { posts: { type: 'Post' } },
    live: { Post: true, User: true },
    mutations: {
      'post.explode': { type: 'Post' },
      'post.like': { type: 'Post' },
      'post.validate': { type: 'Post' },
    },
    queries: { viewer: { type: 'User' } },
    types: { Post: true, User: true },
  });
});
