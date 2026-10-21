import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { defer } from '../defer.ts';
import { getListEntries } from '../list.ts';
import { mutation, type InsertionTarget } from '../mutation.ts';
import { toEntityId } from '../ref.ts';
import { getSelectionPlan } from '../selection.ts';
import { getListKey } from '../store.ts';
import type { Deferred, ViewSelection } from '../types.ts';
import { view } from '../view.ts';

type Comment = { __typename: 'Comment'; content: string; id: string };
type Post = { __typename: 'Post'; comments: Array<Comment> | null; id: string; title: string };
const CommentView = view<Comment>()({ content: true, id: true });
const comments = (category: string) => ({
  args: { category, first: 1 },
  items: { node: CommentView },
  pagination: { hasNext: true as const },
});
const Eager = view<Post>()(
  ({ category }: { category: string }) => ({ comments: comments(category), id: true }) as const,
);
const DeferredPost = view<Post>()(
  ({ category }: { category: string }) =>
    ({ comments: defer(comments(category)), id: true, title: defer(true) }) as const,
);
const setup = async () => {
  const mutations = { add: mutation<Comment, { content: string }, Comment>('Comment') };
  const fetchById = vi.fn().mockResolvedValue([
    {
      comments: {
        items: [{ cursor: 'old', node: { content: 'Old', id: 'old' } }],
        pagination: { hasNext: true, hasPrevious: false, nextCursor: 'old' },
      },
      id: 'post',
    },
  ]);
  const mutate = vi.fn().mockResolvedValue({ content: 'Saved', id: 'saved' });
  const client = createClient<[Record<never, never>, typeof mutations]>({
    mutations,
    roots: {},
    transport: { fetchById, mutate },
    types: [
      { fields: { comments: { listOf: 'Comment' }, title: 'scalar' }, type: 'Post' },
      { fields: { content: 'scalar' }, type: 'Comment' },
    ],
  });
  client.write('Post', { id: 'post' }, new Set(['id']));
  const parent = async (category = 'draft') => {
    const selection = DeferredPost({ category });
    return (
      await client.readView<Post, ViewSelection<typeof selection>, typeof selection>(
        selection,
        client.ref('Post', 'post', selection),
      )
    ).data;
  };
  const seed = (category: string, value: Array<{ content: string; id: string }> | null) => {
    const plan = getSelectionPlan(Eager({ category }), null);
    client.write('Post', { comments: value, id: 'post' }, plan.paths, plan);
    return getListKey(toEntityId('Post', 'post'), 'comments', plan.args.get('comments')?.hash);
  };
  return { client, fetchById, mutate, parent, seed };
};

test('deferred targets update a cached argument-scoped list synchronously without reading it', async () => {
  const { client, fetchById, mutate, parent, seed } = await setup();
  const key = seed('draft', [{ content: 'Draft', id: 'draft' }]);
  const otherKey = seed('published', [{ content: 'Public', id: 'public' }]);
  const post = await parent();
  const read = vi.spyOn(client, 'readDeferred');
  const response = Promise.withResolvers<Comment>();
  mutate.mockReturnValueOnce(response.promise);
  const submission = client.mutations.add({
    input: { content: 'New' },
    insert: { into: post.comments, position: 'before' },
    optimistic: { content: 'New', id: 'temporary' },
    view: CommentView,
  });
  expect(getListEntries(client.store.getListState(key)).map(({ id }) => id)).toEqual([
    'Comment:temporary',
    'Comment:draft',
  ]);
  expect(getListEntries(client.store.getListState(otherKey)).map(({ id }) => id)).toEqual([
    'Comment:public',
  ]);
  expect(read).not.toHaveBeenCalled();
  expect(fetchById).not.toHaveBeenCalled();
  response.resolve({ __typename: 'Comment', content: 'Saved', id: 'saved' });
  await submission;
  expect(getListEntries(client.store.getListState(key)).map(({ id }) => id)).toEqual([
    'Comment:saved',
    'Comment:draft',
  ]);
});

test('unloaded targets keep confirmed insertions pending until the real page is requested', async () => {
  const { client, fetchById, parent } = await setup();
  const post = await parent();
  await client.mutations.add({
    input: { content: 'New' },
    insert: { into: post.comments, position: 'after' },
    view: CommentView,
  });
  expect(fetchById).not.toHaveBeenCalled();
  const list = client.store.dehydrate().lists[0][1];
  expect(list.ids).toEqual([]);
  expect(list.pendingAfterIds).toEqual(['Comment:saved']);
  expect(client.store.read('Post:post')?.comments).toBeUndefined();
  const snapshot = await client.readDeferred(post.comments);
  expect(snapshot.data?.items.map(({ node }) => node.id)).toEqual(['old', 'saved']);
  expect(snapshot.data?.pagination.hasNext).toBe(true);
  await client.readDeferred(post.comments);
  expect(fetchById).toHaveBeenCalledOnce();
});

test.each([true, false])(
  'an unloaded optimistic insertion survives a racing page and then settles (success: %s)',
  async (success) => {
    const { client, fetchById, mutate, parent } = await setup();
    const post = await parent();
    const response = Promise.withResolvers<Comment>();
    mutate.mockReturnValueOnce(response.promise);
    const submission = client.mutations.add({
      input: { content: 'New' },
      insert: { into: post.comments, position: 'before' },
      optimistic: { content: 'New', id: 'temporary' },
      view: CommentView,
    });
    const failure = success ? undefined : expect(submission).rejects.toThrow('Refused');
    expect(fetchById).not.toHaveBeenCalled();
    const snapshot = await client.readDeferred(post.comments);
    expect(snapshot.data?.items.map(({ node }) => node.id)).toEqual(['temporary', 'old']);
    if (success) {
      response.resolve({ __typename: 'Comment', content: 'Saved', id: 'saved' });
      await submission;
    } else {
      response.reject(new Error('Refused'));
      await failure;
    }
    const settled = await client.readDeferred(post.comments);
    expect(settled.data?.items.map(({ node }) => node.id)).toEqual(
      success ? ['saved', 'old'] : ['old'],
    );
    expect(client.store.read('Comment:temporary')).toBeUndefined();
    expect(fetchById).toHaveBeenCalledOnce();
  },
);

test('foreign and non-list deferred values are rejected before optimism or network delivery', async () => {
  const { client, fetchById, mutate, parent } = await setup();
  const other = await setup();
  const foreign = await other.parent();
  const post = await parent();
  for (const into of [foreign.comments, post.title]) {
    await expect(
      client.mutations.add({
        input: { content: 'Invalid' },
        insert: { into: into as never, position: 'before' },
        optimistic: { content: 'Invalid', id: 'temporary' },
      }),
    ).rejects.toThrow('list');
  }
  expect(mutate).not.toHaveBeenCalled();
  expect(fetchById).not.toHaveBeenCalled();
  expect(client.store.read('Comment:temporary')).toBeUndefined();
  expectTypeOf(post.comments).toExtend<InsertionTarget<'Comment'>>();
  expectTypeOf<Deferred<string>>().not.toExtend<InsertionTarget<'Comment'>>();
  expectTypeOf<Deferred<Array<Post>>>().not.toExtend<InsertionTarget<'Comment'>>();
});

test('a confirmed null deferred list stays null when inserting a new record', async () => {
  const { client, fetchById, parent, seed } = await setup();
  const key = seed('draft', null);
  const post = await parent();
  await client.mutations.add({
    input: { content: 'New' },
    insert: { into: post.comments, position: 'after' },
    view: CommentView,
  });
  expect((await client.readDeferred(post.comments)).data).toBeNull();
  expect(client.store.getListState(key)).toBeUndefined();
  expect(client.store.read('Comment:saved')?.content).toBe('Saved');
  expect(fetchById).not.toHaveBeenCalled();
});

test('reading a parent keeps deferred selection processing lazy until insertion', async () => {
  const { client, fetchById } = await setup();
  const args = vi.fn(() => ({ category: 'draft' }));
  const Deferred = view<Post>()({
    comments: defer({
      get args() {
        return args();
      },
      items: { node: CommentView },
    }),
    id: true,
  });
  const { data: post } = await client.readView<
    Post,
    ViewSelection<typeof Deferred>,
    typeof Deferred
  >(Deferred, client.ref('Post', 'post', Deferred));
  expect(args).not.toHaveBeenCalled();
  await client.mutations.add({
    input: { content: 'New' },
    insert: { into: post.comments, position: 'after' },
    view: CommentView,
  });
  expect(args).toHaveBeenCalled();
  expect(fetchById).not.toHaveBeenCalled();
});

test.each([true, false])(
  'unloaded targets without pagination arguments fetch real data once (connection: %s)',
  async (connection) => {
    const { client, fetchById } = await setup();
    const DeferredArray = view<Post>()({ comments: defer({ content: true, id: true }), id: true });
    const DeferredConnection = view<Post>()({
      comments: defer({ items: { node: CommentView } }),
      id: true,
    });
    const selection = connection ? DeferredConnection : DeferredArray;
    const { data: post } = await client.readView<
      Post,
      ViewSelection<typeof selection>,
      typeof selection
    >(selection, client.ref('Post', 'post', selection));
    await client.mutations.add({
      input: { content: 'New' },
      insert: { into: post.comments, position: 'after' },
      view: CommentView,
    });
    expect(fetchById).not.toHaveBeenCalled();
    fetchById.mockResolvedValueOnce([
      {
        comments: [
          { content: 'Old', id: 'old' },
          { content: 'Saved', id: 'saved' },
        ],
        id: 'post',
      },
    ]);
    type Data = typeof post.comments extends Deferred<infer Value> ? Value : never;
    const { data } = await client.readDeferred<Data>(post.comments);
    expect(
      data && ('items' in data ? data.items.map(({ node }) => node.id) : data.map(({ id }) => id)),
    ).toEqual(['old', 'saved']);
    await client.readDeferred<Data>(post.comments);
    expect(fetchById).toHaveBeenCalledOnce();
  },
);
