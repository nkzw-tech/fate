import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { initTRPC } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { alias } from '../../alias.ts';
import { createClient } from '../../client.ts';
import { createClientSource } from '../../codegen/client.ts';
import { createSchema } from '../../codegen/schema.ts';
import { createHTTPTransport } from '../../httpTransport.ts';
import { clientRoot } from '../../root.ts';
import { createTRPCTransport } from '../../transport.ts';
import type { AnyRecord, ViewRef } from '../../types.ts';
import { view } from '../../view.ts';
import { viewFor } from '../../viewFor.ts';
import { withConnection } from '../connection.ts';
import { computed, dataView, list, type DataView } from '../dataView.ts';
import { createSourceRegistry } from '../executor.ts';
import { createFateServer, type InferFateAPI } from '../http.ts';
import { createPrismaSourceAdapter } from '../prisma.ts';
import type { SourceDefinition } from '../source.ts';
import { bindViewProcedures } from '../sourceRouter.ts';

test.each(['native', 'trpc'] as const)(
  'loads and paginates a mixed connection through %s',
  async (kind) => {
    type Post = { id: string; title: string };
    type User = { id: string; name: string };
    const postView = dataView<Post>('Post')({ id: true, title: true });
    const userView = dataView<User>('User')({
      id: true,
      name: true,
      privateLabel: computed<User, string>({
        authorize: () => false,
        resolve: () => 'private',
      }),
    });
    const postSource: SourceDefinition = { id: 'id', view: postView };
    const userSource: SourceDefinition = { id: 'id', view: userView };
    const posts = [
      { id: '2', title: 'Second post' },
      { id: '1', title: 'First post' },
    ];
    const users = [
      { id: '2', name: 'Bea' },
      { id: '1', name: 'Ada' },
    ];
    const findPosts = vi.fn(async ({ ids }: { ids: Array<string> }) =>
      posts.filter(({ id }) => ids.includes(id)),
    );
    const findUsers = vi.fn(async ({ ids }: { ids: Array<string> }) =>
      users.filter(({ id }) => ids.includes(id)),
    );
    const sources = {
      getSource: <Item extends AnyRecord>(target: DataView<Item> | SourceDefinition<Item>) =>
        ('view' in target
          ? target
          : target.typeName === 'Post'
            ? postSource
            : userSource) as SourceDefinition<Item>,
      registry: createSourceRegistry([
        [postSource, { byIds: findPosts }],
        [userSource, { byIds: findUsers }],
      ]),
    };
    const entries = [
      { __typename: 'Post', cursor: 'post-1', id: '1' },
      { __typename: 'User', cursor: 'user-1', id: '1' },
      { __typename: 'Post', cursor: 'post-2', id: '2' },
      { __typename: 'User', cursor: 'user-2', id: '2' },
    ] as const;
    const feed = list(
      { Post: postView, User: userView },
      {
        async query({ cursor, direction, take }) {
          const index = entries.findIndex((entry) => entry.cursor === cursor);
          return direction === 'backward'
            ? entries.slice(0, index < 0 ? entries.length : index).slice(-take)
            : entries.slice(index + 1, index + 1 + take);
        },
        typeName: 'FeedItem',
      },
    );
    const Root = { feed };
    const fateServer = createFateServer({ roots: Root, sources });
    const t = initTRPC.create();
    const procedures = bindViewProcedures({
      ...sources,
      createConnectionProcedure: withConnection(t.procedure),
      procedure: t.procedure,
    });
    const appRouter = t.router({ feedItem: t.router(procedures({ view: feed })) });
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      return kind === 'native'
        ? fateServer.handleRequest(request)
        : fetchRequestHandler({ endpoint: '/trpc', req: request, router: appRouter });
    });
    type API = InferFateAPI<typeof fateServer>;
    const transport =
      kind === 'native'
        ? createHTTPTransport<API>({
            fetch,
            live: false,
            url: 'http://test.local/fate',
            mixedLists: ['feed'],
          })
        : createTRPCTransport<typeof appRouter>({
            byId: {},
            client: createTRPCClient<typeof appRouter>({
              links: [httpBatchLink({ fetch, url: 'http://test.local/trpc' })],
            }),
            lists: { feed: (client) => client.feedItem.list.query },
          });
            mixedLists: ['feed'],
    const roots = { feed: clientRoot<API['lists']['feed']['output'], 'FeedItem'>('FeedItem') };
    const { types } = createSchema([], Root);
    const generated = createClientSource({
      moduleExports: { appRouter, fateServer, Root },
      moduleName: './contract.ts',
      transport: kind,
    });
    expect(generated).toContain('possibleTypes: ["Post","User"]');
    expect(generated).toContain('mixedLists: ["feed"]');

    const client = createClient<[typeof roots, Record<never, never>]>({ roots, transport, types });
    type PostResult = Post & { __typename: 'Post' };
    type UserResult = User & { __typename: 'User'; privateLabel: string | null };
    const PostView = view<PostResult>()({ id: true, label: alias('title', true) });
    const UserView = view<UserResult>()({
      id: true,
      label: alias('name', { args: { prefix: '@' } }),
      privateLabel: true,
    });
    const FeedView = view<PostResult | UserResult>()({
      ...viewFor('Post', PostView),
      ...viewFor('User', UserView),
    });
    const request = { feed: { args: { first: 3 }, list: FeedView } };
    const result = await client.request(request);
    expectTypeOf(result.feed).toEqualTypeOf<Array<ViewRef<'Post'> | ViewRef<'User'>>>();
    expect(result.feed.map(({ __typename, id }) => [__typename, id])).toEqual([
      ['Post', '1'],
      ['User', '1'],
      ['Post', '2'],
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(findPosts).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        ids: ['1', '2'],
        plan: expect.objectContaining({ selectedPaths: new Set(['id', 'title']) }),
      }),
    );
    expect(findUsers).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        ids: ['1'],
        plan: expect.objectContaining({
          args: expect.objectContaining({ name: { prefix: '@' } }),
          selectedPaths: new Set(['id', 'name', 'privateLabel']),
        }),
      }),
    );
    const read = await Promise.all(
      result.feed.map(async (ref) =>
        ref.__typename === 'Post'
          ? (await client.readView(PostView, ref)).data
          : (await client.readView(UserView, ref)).data,
      ),
    );
    expect(read).toMatchObject([
      { label: 'First post' },
      { label: 'Ada', privateLabel: null },
      { label: 'Second post' },
    ]);
    await client.request(request);
    expect(fetch).toHaveBeenCalledTimes(1);
    const next = await client.request({
      feed: { args: { after: 'post-2', first: 3 }, list: FeedView },
    });
    expect(next.feed).toMatchObject([{ __typename: 'User', id: '2' }]);
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(transport.fetchList!('feed', ['unregistered:name:Tag'])).rejects.toThrow(
      /Invalid list type selection/,
    );
    expect(findPosts).toHaveBeenCalledTimes(1);
    expect(findUsers).toHaveBeenCalledTimes(2);

    const previous = await client.request({
      feed: { args: { before: 'user-2', last: 2 }, list: FeedView },
    });
    expect(previous.feed).toMatchObject([
      { __typename: 'User', id: '1' },
      { __typename: 'Post', id: '2' },
    ]);
  },
);

test('keeps mixed-list-only sources out of native by-ID reads', async () => {
  const document = dataView<{ body: string; id: string }>('Document')({ body: true, id: true });
  const publicPost = dataView<{ id: string }>('Post')({ id: true });
  const documentSource = { id: 'id', view: document };
  const postSource = { id: 'id', view: publicPost };
  const documents = vi.fn(async () => [{ body: 'Private document', id: 'secret' }]);
  const server = createFateServer({
    roots: {
      feed: list(
        { Document: document, Post: publicPost },
        { query: async () => [], typeName: 'FeedItem' },
      ),
      posts: list(publicPost),
    },
    sources: {
      getSource: <Item extends AnyRecord>(target: DataView<Item> | SourceDefinition<Item>) =>
        ('view' in target
          ? target
          : target.typeName === 'Document'
            ? documentSource
            : postSource) as SourceDefinition<Item>,
      registry: createSourceRegistry([
        [documentSource, { byIds: documents }],
        [postSource, { byIds: async () => [{ id: 'public' }] }],
      ]),
    },
  });
  const response = await server.handleRequest(
    new Request('http://test.local/fate', {
      body: JSON.stringify({
        operations: [
          { id: '1', kind: 'list', name: 'feed', select: ['body'] },
          { id: '2', ids: ['secret'], kind: 'byId', select: ['body'], type: 'Document' },
          { id: '3', ids: ['public'], kind: 'byId', select: ['id'], type: 'Post' },
        ],
        version: 1,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  );

  expect(await response.json()).toMatchObject({
    results: [
      { data: { items: [] }, ok: true },
      { error: { code: 'NOT_FOUND' }, ok: false },
      { data: [{ id: 'public' }], ok: true },
    ],
  });
  expect(documents).not.toHaveBeenCalled();
  expect(server.manifest.types).toEqual({ Post: true });
});

test('discovers mixed list member views from the root declaration', () => {
  const article = dataView<{ id: string }>('Article')({ id: true });
  const Root = {
    feed: { view: list({ Article: article }, { query: async () => [], typeName: 'FeedItem' }) },
  };
  const sources = createPrismaSourceAdapter({ views: { Root } });

  expect(sources.getSource(article).view).toBe(article);
  expect(createFateServer({ roots: Root, sources }).manifest.lists).toEqual({
    feed: { type: 'FeedItem' },
  });
});

test('rejects a repeated member even when the second occurrence is the lookahead row', async () => {
  const post = dataView<{ id: string }>('Post')({ id: true });
  const sources = createPrismaSourceAdapter({ views: { post } });
  const server = createFateServer({
    context: () => ({ prisma: { post: { findMany: async () => [{ id: 'post' }] } } }),
    roots: {
      feed: list(
        { Post: post },
        {
          query: async () => [
            { __typename: 'Post' as const, cursor: 'first', id: 'post' },
            { __typename: 'Post' as const, cursor: 'second', id: 'post' },
          ],
          typeName: 'FeedItem',
        },
      ),
    },
    sources,
  });
  const transport = createHTTPTransport({
    fetch: (input, init) => server.handleRequest(new Request(input, init)),
    live: false,
    url: 'http://test.local/fate',
  });

  await expect(transport.fetchList!('feed', ['id'], { first: 1 })).rejects.toThrow(
    /repeated member/,
  );
});
