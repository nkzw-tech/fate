import { buildSchema, graphql } from 'graphql';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { createGraphQLArgumentSchema } from '../codegen/graphql.ts';
import { createGraphQLTransport, graphqlMutation } from '../graphqlTransport.ts';
import { mutation, type ListInsertion, type MutationOptions } from '../mutation.ts';
import { toEntityId } from '../ref.ts';
import { clientRoot } from '../root.ts';
import { getSelectionPlan } from '../selection.ts';
import type { ViewSelection } from '../types.ts';
import { view } from '../view.ts';

type Post = { __typename: 'Post'; comments: Array<Comment>; id: string; title: string };
type Comment = { __typename: 'Comment'; content: string; id: string; post: Post };
const PostView = view<Post>()({ id: true, title: true });
const CommentView = view<Comment>()({ content: true, id: true, post: { id: true } });
const connection = { items: { node: PostView } } as const;
const roots = {
  otherPosts: clientRoot<Array<Post>, 'Post'>('Post'),
  posts: clientRoot<Array<Post>, 'Post'>('Post'),
};
const mutations = {
  create: mutation<Post, { title: string }, Post>('Post'),
  save: mutation<Post, { id: string; title: string }, Post>('Post'),
};
const setup = () => {
  const mutate = vi
    .fn()
    .mockImplementation(async (_name: string, input: { id?: string; title: string }) => ({
      id: input.id ?? 'new',
      title: input.title,
    }));
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport: {
      fetchById: async () => [],
      fetchList: async (procedure, _selection, args) => ({
        items: [
          {
            cursor: 'cursor',
            node: {
              id: String(args?.category ?? (procedure === 'posts' ? 'first' : 'second')),
              title: 'Old',
            },
          },
        ],
        pagination: { hasNext: false, hasPrevious: false },
      }),
      mutate,
    },
    types: [
      { fields: { comments: { listOf: 'Comment' }, title: 'scalar' }, type: 'Post' },
      { fields: { content: 'scalar', post: { type: 'Post' } }, type: 'Comment' },
    ],
  });
  const first = { posts: { list: connection } };
  const second = { otherPosts: { list: connection } };
  const ids = (request: typeof first | typeof second) =>
    Object.values(client.getRequestResult(request))[0].items.map(({ node }) => node.id);
  return { client, first, ids, mutate, second };
};

test('default mutations normalize fields without inserting records into filtered lists', async () => {
  const { client, first, ids, second } = setup();
  await client.request(first);
  await client.request(second);
  await client.mutations.save({ input: { id: 'first', title: 'Updated' }, view: PostView });
  const submission = client.mutations.create({
    input: { title: 'Private' },
    optimistic: { id: 'temporary', title: 'Private' },
    view: PostView,
  });
  expect(ids(first)).toEqual(['first']);
  expect(ids(second)).toEqual(['second']);
  expect(client.store.read(toEntityId('Post', 'temporary'))?.title).toBe('Private');
  await submission;
  expect(ids(first)).toEqual(['first']);
  expect(ids(second)).toEqual(['second']);
  expect(client.store.read(toEntityId('Post', 'first'))?.title).toBe('Updated');
  expect(client.store.read(toEntityId('Post', 'new'))?.title).toBe('Private');
});

test('ordinary normalization does not infer membership from a parent reference', () => {
  const { client } = setup();
  const ParentView = view<Post>()({ comments: { items: { node: CommentView } }, id: true });
  const plan = getSelectionPlan(ParentView, null);
  client.write('Post', { comments: [], id: 'parent' }, plan.paths, plan);
  client.write(
    'Comment',
    { content: 'New', id: 'comment', post: { id: 'parent' } },
    new Set(['id', 'content', 'post.id']),
  );
  expect(client.store.getListsForField(toEntityId('Post', 'parent'), 'comments')[0][1].ids).toEqual(
    [],
  );
});

test('scoped insertion updates the current list when passed an older snapshot', async () => {
  const { client, first, ids, second } = setup();
  const firstSnapshot = (await client.request(first)).posts;
  await client.request(second);
  await client.mutations.save({
    input: { id: 'new-1', title: 'New' },
    insert: { into: firstSnapshot, position: 'before' },
    view: PostView,
  });
  await client.mutations.save({
    input: { id: 'new-2', title: 'Newer' },
    insert: { into: firstSnapshot, position: 'after' },
    view: PostView,
  });
  expect(ids(first)).toEqual(['new-1', 'first', 'new-2']);
  expect(ids(second)).toEqual(['second']);
});

test('multiple targets can use different positions and deduplicate existing members', async () => {
  const { client, first, ids, second } = setup();
  const a = (await client.request(first)).posts;
  const b = (await client.request(second)).otherPosts;
  const insert = [
    { into: a, position: 'before' },
    { into: b, position: 'after' },
  ] as const;
  await client.mutations.save({ input: { id: 'new', title: 'New' }, insert, view: PostView });
  await client.mutations.save({ input: { id: 'new', title: 'Updated' }, insert, view: PostView });
  expect(ids(first)).toEqual(['new', 'first']);
  expect(ids(second)).toEqual(['second', 'new']);
});

test('optimistic scoped insertions roll back together without changing sibling lists', async () => {
  const { client, first, ids, mutate, second } = setup();
  const a = (await client.request(first)).posts;
  await client.request(second);
  const response = Promise.withResolvers<{ id: string; title: string }>();
  mutate.mockReturnValueOnce(response.promise);
  const submission = client.mutations.create({
    input: { title: 'Optimistic' },
    insert: { into: a, position: 'before' },
    optimistic: { id: 'temporary', title: 'Optimistic' },
    view: PostView,
  });
  expect(ids(first)).toEqual(['temporary', 'first']);
  expect(ids(second)).toEqual(['second']);
  response.reject(new Error('offline'));
  await expect(submission).rejects.toThrow('offline');
  expect(ids(first)).toEqual(['first']);
  expect(client.store.read(toEntityId('Post', 'temporary'))).toBeUndefined();
});

test('scoped optimistic IDs reconcile with the server ID once in every target', async () => {
  const { client, first, ids, mutate, second } = setup();
  const a = (await client.request(first)).posts;
  const b = (await client.request(second)).otherPosts;
  const response = Promise.withResolvers<{ id: string; title: string }>();
  mutate.mockReturnValueOnce(response.promise);
  const submission = client.mutations.create({
    input: { title: 'New' },
    insert: [
      { into: a, position: 'before' },
      { into: b, position: 'after' },
    ],
    optimistic: { id: 'temporary', title: 'New' },
    view: PostView,
  });
  expect(ids(first)).toEqual(['temporary', 'first']);
  response.resolve({ id: 'server', title: 'Confirmed' });
  await submission;
  expect(ids(first)).toEqual(['server', 'first']);
  expect(ids(second)).toEqual(['second', 'server']);
  expect(client.store.read(toEntityId('Post', 'temporary'))).toBeUndefined();
});

test('scoped targets must be normalized lists belonging to the same client', async () => {
  const { client, first, mutate } = setup();
  const other = setup();
  const foreign = (await other.client.request(other.first)).posts;
  await expect(
    client.mutations.create({
      input: { title: 'Invalid' },
      insert: { into: foreign, position: 'after' },
    }),
  ).rejects.toThrow('list');
  await expect(
    client.mutations.create({
      input: { title: 'Invalid' },
      insert: { into: { items: [] }, position: 'after' },
    }),
  ).rejects.toThrow('list');
  expect(mutate).not.toHaveBeenCalled();
  await client.request(first);
});

test('scoped insertion distinguishes filters on the same root and supports array results', async () => {
  const { client } = setup();
  const draftRequest = { posts: { args: { category: 'draft' }, list: PostView } };
  const publicRequest = { posts: { args: { category: 'published' }, list: PostView } };
  const drafts = (await client.request(draftRequest)).posts;
  await client.request(publicRequest);
  await client.mutations.create({
    input: { title: 'Draft' },
    insert: { into: drafts, position: 'before' },
    view: PostView,
  });
  expect(client.getRequestResult(draftRequest).posts.map(({ id }) => id)).toEqual(['new', 'draft']);
  expect(client.getRequestResult(publicRequest).posts.map(({ id }) => id)).toEqual(['published']);
});

test.each([true, false])(
  'nested insertion keeps argument-scoped siblings intact (connection: %s)',
  async (connection) => {
    const commentMutations = { add: mutation<Comment, { content: string }, Comment>('Comment') };
    const client = createClient<[Record<never, never>, typeof commentMutations]>({
      mutations: commentMutations,
      roots: {},
      transport: {
        fetchById: async () => [],
        mutate: vi.fn().mockResolvedValue({ content: 'New', id: 'new-comment' }),
      },
      types: [
        { fields: { comments: { listOf: 'Comment' } }, type: 'Post' },
        { fields: { content: 'scalar' }, type: 'Comment' },
      ],
    });
    const NodeView = view<Comment>()({ content: true, id: true });
    const ConnectionView = view<Post>()(
      ({ category }: { category: string }) =>
        ({
          comments: { args: { category }, items: { node: NodeView } },
          id: true,
        }) as const,
    );
    const ArrayView = view<Post>()(
      ({ category }: { category: string }) =>
        ({ comments: { args: { category }, content: true, id: true }, id: true }) as const,
    );
    const CommentsView = connection ? ConnectionView : ArrayView;
    const seed = async (category: string) => {
      const selection = CommentsView({ category });
      const plan = getSelectionPlan(selection, null);
      client.write(
        'Post',
        { comments: [{ content: category, id: category }], id: 'parent' },
        plan.paths,
        plan,
      );
      const ref = client.ref<Post>('Post', 'parent', selection);
      return {
        read: () =>
          client.readView<Post, ViewSelection<typeof selection>, typeof selection>(selection, ref),
        selection,
      };
    };
    const drafts = await seed('draft');
    const published = await seed('published');
    const target = (await drafts.read()).data.comments;
    const notifications = vi.fn();
    const snapshot = await drafts.read();
    const cleanup = snapshot.coverage.map(([id, fields]) =>
      client.store.subscribe(id, fields, notifications),
    );
    await client.mutations.add({
      input: { content: 'New' },
      insert: { into: target, position: 'before' },
      view: NodeView,
    });
    const getIds = (data: typeof target) =>
      'items' in data ? data.items.map(({ node }) => node.id) : data.map(({ id }) => id);
    expect(getIds((await drafts.read()).data.comments)).toEqual(['new-comment', 'draft']);
    expect(getIds((await published.read()).data.comments)).toEqual(['published']);
    expect(notifications).toHaveBeenCalled();
    cleanup.forEach((dispose) => dispose());
  },
);

test('explicit string insertion preserves broad root insertion', async () => {
  const { client, first, ids, second } = setup();
  await client.request(first);
  await client.request(second);
  await client.mutations.create({ input: { title: 'Shared' }, insert: 'after', view: PostView });
  expect(ids(first)).toEqual(['first', 'new']);
  expect(ids(second)).toEqual(['second', 'new']);
});

test('invalid or conflicting scoped insertion instructions fail before mutation execution', async () => {
  const { client, first, mutate } = setup();
  const into = (await client.request(first)).posts;
  await expect(
    client.mutations.create({
      input: { title: 'Conflict' },
      insert: [
        { into, position: 'before' },
        { into, position: 'after' },
      ],
    }),
  ).rejects.toThrow('Conflicting');
  await expect(
    client.mutations.create({
      input: { title: 'Invalid' },
      insert: { into, position: 'invalid' as never },
    }),
  ).rejects.toThrow('insertion');
  expect(mutate).not.toHaveBeenCalled();
});

test('targeted lists are retained during mutation execution and released afterward', async () => {
  const { client, first, mutate } = setup();
  const into = (await client.request(first)).posts;
  const response = Promise.withResolvers<{ id: string; title: string }>();
  mutate.mockReturnValueOnce(response.promise);
  const submission = client.mutations.create({
    input: { title: 'New' },
    insert: { into, position: 'after' },
    view: PostView,
  });
  client.gc();
  expect(client.getRequestResult(first).posts.items.map(({ node }) => node.id)).toEqual(['first']);
  response.resolve({ id: 'new', title: 'Confirmed' });
  await submission;
  client.gc();
  expect(client.getRequestResult(first).posts.items).toEqual([]);
});

test('insertion options constrain target entity types for mutations and actions', async () => {
  const { client, first } = setup();
  const into = (await client.request(first)).posts;
  const insert = { into, position: 'before' } as const;
  type Options = Parameters<typeof client.mutations.create>[0];
  expectTypeOf(insert).toExtend<NonNullable<Options['insert']>>();
  expectTypeOf<ListInsertion<'Post'>>().not.toExtend<
    NonNullable<
      MutationOptions<
        ReturnType<typeof mutation<Comment, object, Comment>> & { key: 'add' }
      >['insert']
    >
  >();
  expectTypeOf(client.actions.create).parameter(1).toEqualTypeOf<Options | 'reset'>();
  expectTypeOf<{ into: typeof into; position: 'none' }>().not.toExtend<
    NonNullable<Options['insert']>
  >();
});

test('GraphQL filtered connections normalize by default and accept scoped insertion', async () => {
  const schema = buildSchema(`
    type Query { posts(category: String!): Connection! }
    type Mutation { createPost(title: String!): Post! }
    type Post { id: ID! title: String! }
    type Connection { edges: [Edge!]! pageInfo: PageInfo! }
    type Edge { cursor: String! node: Post! }
    type PageInfo { endCursor: String startCursor: String hasNextPage: Boolean! hasPreviousPage: Boolean! }
  `);
  const types = [{ fields: { title: 'scalar' as const }, type: 'Post' }];
  const graphqlMutations = {
    create: graphqlMutation<Post, { title: string }, Post>('Post', {
      field: 'createPost',
      inputArg: false,
    }),
  };
  const graphqlRoots = { posts: clientRoot('Post') };
  const definitions = { create: mutation<Post, { title: string }, Post>('Post') };
  let nextId = 0;
  const client = createClient<[typeof graphqlRoots, typeof definitions]>({
    mutations: definitions,
    roots: graphqlRoots,
    transport: createGraphQLTransport({
      decodeNodeId: (_type, id) => id,
      fetch: async (_url, init) => {
        const { query, variables } = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify(
            await graphql({
              rootValue: {
                createPost: ({ title }: { title: string }) => ({ id: `new-${++nextId}`, title }),
                posts: ({ category }: { category: string }) => ({
                  edges: [{ cursor: category, node: { id: category, title: category } }],
                  pageInfo: { hasNextPage: false, hasPreviousPage: false },
                }),
              },
              schema,
              source: query,
              variableValues: variables,
            }),
          ),
        );
      },
      live: false,
      mutations: graphqlMutations,
      roots: { posts: { type: 'Post' } },
      schema: createGraphQLArgumentSchema(schema),
      types,
      url: '/graphql',
    }),
    types,
  });
  const draftsRequest = { posts: { args: { category: 'draft' }, list: connection } };
  const publicRequest = { posts: { args: { category: 'public' }, list: connection } };
  const drafts = (await client.request(draftsRequest)).posts;
  await client.request(publicRequest);
  await client.mutations.create({ input: { title: 'Unlisted' }, view: PostView });
  expect(client.getRequestResult(draftsRequest).posts.items).toHaveLength(1);
  const response = await client.mutations.create({
    input: { title: 'Draft' },
    insert: { into: drafts, position: 'before' },
    view: PostView,
  });
  expectTypeOf(response.result).toEqualTypeOf<Post | undefined>();
  expect(client.getRequestResult(draftsRequest).posts.items.map(({ node }) => node.id)).toEqual([
    'new-2',
    'draft',
  ]);
  expect(client.getRequestResult(publicRequest).posts.items.map(({ node }) => node.id)).toEqual([
    'public',
  ]);
});
