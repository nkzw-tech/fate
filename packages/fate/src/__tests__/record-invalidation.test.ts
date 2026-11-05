import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { mutation } from '../mutation.ts';
import { isNodeRef } from '../node-ref.ts';
import { createPersistence } from '../persistence.ts';
import { clientRoot } from '../root.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

type Post = { __typename: 'Post'; content: string; id: string; title: string };
type Comment = { __typename: 'Comment'; id: string };
const Title = view<Post>()({ title: true });
const Content = view<Post>()({ content: true });
const post = { post: { id: '1', view: { ...Title, ...Content } } };
const title = { post: { id: '1', view: Title } };
const content = { post: { id: '1', view: Content } };
const other = { post: { id: '2', view: Title } };
const roots = { post: clientRoot('Post') };
const mutations = { addComment: mutation<Comment, { postId: string }, Comment>('Comment') };
const setup = (persistence?: ReturnType<typeof createPersistence>) => {
  const mutate = vi.fn().mockResolvedValue({ id: 'comment' });
  const fetchById = vi.fn(
    async (
      _type: string,
      ids: Array<string | number>,
    ): Promise<Array<Partial<Omit<Post, 'id'>> & { id: string | number }>> =>
      ids.map((id) => ({ content: 'Content', id, title: 'Title' })),
  );
  const fetchQuery = vi.fn(async (): Promise<Partial<Post> | null> => ({
    id: '1',
    title: 'Title',
  }));
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    persistence,
    roots,
    transport: { fetchById, fetchQuery, mutate, mutateDurably: mutate },
    types: [{ type: 'Post' }, { type: 'Comment' }],
  });
  return { client, fetchById, fetchQuery, mutate };
};

test('a view ref invalidates the record across views and only refreshes fetched fields', async () => {
  const { client, fetchById } = setup();
  const { post: postRef } = await client.request(post);
  await client.request(other);
  await client.mutations.addComment({ input: { postId: '1' }, invalidate: [postRef] });

  expect(client.observeRequest(post, { mode: 'cache-only' }).getSnapshot().data?.post.id).toBe('1');
  expect(client.store.read('Post:1')).toMatchObject({ content: 'Content', title: 'Title' });
  await client.request(other);
  expect(fetchById).toHaveBeenCalledTimes(2);

  fetchById.mockResolvedValueOnce([{ id: '1', title: 'New title' }]);
  await client.request(title);
  await client.request(title);
  expect(fetchById).toHaveBeenCalledTimes(3);
  expect(client.store.read('Post:1')).toMatchObject({ content: 'Content', title: 'New title' });

  fetchById.mockResolvedValueOnce([{ content: 'New content', id: '1' }]);
  await client.request(content);
  expect(fetchById).toHaveBeenCalledTimes(4);
  expect(client.store.read('Post:1')).toMatchObject({ content: 'New content', title: 'New title' });
});

test('an older response cannot overwrite or refresh an invalidated record', async () => {
  const { client, fetchById, mutate } = setup();
  const { post: postRef } = await client.request(post);
  mutate.mockRejectedValueOnce(new Error('comment failed'));
  await expect(
    client.mutations.addComment({ input: { postId: '1' }, invalidate: [postRef] }),
  ).rejects.toThrow('comment failed');
  await client.request(post);
  expect(fetchById).toHaveBeenCalledTimes(1);

  const older = Promise.withResolvers<Awaited<ReturnType<typeof fetchById>>>();
  fetchById.mockReturnValueOnce(older.promise);
  const pending = client.request(post, { mode: 'network-only' });
  await client.mutations.addComment({ input: { postId: '1' }, invalidate: [postRef] });
  older.resolve([{ content: 'Old content', id: '1', title: 'Old title' }]);
  await pending;
  expect(client.store.read('Post:1')).toMatchObject({ content: 'Content', title: 'Title' });
  await client.request(post);
  expect(fetchById).toHaveBeenCalledTimes(3);
});

test('record staleness survives hydration', async () => {
  const { client } = setup();
  const { post: postRef } = await client.request(post);
  await client.mutations.addComment({ input: { postId: '1' }, invalidate: [postRef] });
  const next = setup();
  next.client.hydrate(client.dehydrate());
  expect(next.client.observeRequest(post, { mode: 'cache-only' }).getSnapshot().data?.post.id).toBe(
    '1',
  );
  await next.client.request(post);
  expect(next.fetchById).toHaveBeenCalledTimes(1);
});

test.each([false, true])(
  'persisted invalidation preserves newer fields from another tab (pending edit: %s)',
  async (pendingEdit) => {
    const storage = memoryStorage();
    const create = () => setup(createPersistence({ key: 'invalidation-race', storage }));
    const first = create();
    const second = create();
    const next = create();
    const response = Promise.withResolvers<Awaited<ReturnType<typeof next.fetchById>>>();
    const refreshed = { content: 'Server content', id: '1', title: 'Latest title' };
    try {
      await first.client.request(post);
      await first.client.persistence!.flush();
      const { post: staleRef } = await second.client.request(post);
      await second.client.persistence!.flush();

      first.client.write('Post', { id: '1', title: 'Latest title' }, new Set(['title']));
      await first.client.persistence!.flush();
      expect(second.client.store.read('Post:1')?.title).toBe('Title');
      if (pendingEdit) {
        second.client.write('Post', { content: 'Local edit', id: '1' }, new Set(['content']));
      }
      await second.client.mutations.addComment({
        input: { postId: '1' },
        invalidate: [staleRef],
        persist: false,
      });
      await second.client.persistence!.flush();

      next.fetchById.mockReturnValueOnce(response.promise);
      const refresh = next.client.request(post);
      try {
        await vi.waitFor(() => expect(next.fetchById).toHaveBeenCalledOnce());
        expect(next.client.store.read('Post:1')).toMatchObject({
          content: pendingEdit ? 'Local edit' : 'Content',
          title: 'Latest title',
        });
      } finally {
        response.resolve([refreshed]);
        await refresh;
      }
    } finally {
      for (const { client } of [first, second, next]) {
        client.persistence!.dispose();
      }
    }
  },
);

test('a replayed offline mutation invalidates its parent record on disk', async () => {
  const storage = memoryStorage();
  const create = (online: boolean) =>
    setup(createPersistence({ key: 'posts', online: () => online, storage }));
  const first = create(false);
  const { post: postRef } = await first.client.request(post);
  await first.client.persistence!.flush();
  const pending = first.client.mutations
    .addComment({ input: { postId: '1' }, invalidate: [postRef] })
    .catch(() => {});
  try {
    await vi.waitFor(() =>
      expect(first.client.persistence!.getSnapshot().mutations).toHaveLength(1),
    );
  } finally {
    first.client.persistence!.dispose();
    await pending;
  }

  const replay = create(true);
  try {
    await vi.waitFor(() => expect(replay.mutate).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(replay.client.persistence!.getSnapshot().mutations).toHaveLength(0),
    );
    await replay.client.persistence!.flush();
  } finally {
    replay.client.persistence!.dispose();
  }

  const next = create(true);
  try {
    await next.client.request(title);
    await next.client.request(title);
    expect(next.fetchById).toHaveBeenCalledTimes(1);
    await next.client.request(content);
    expect(next.fetchById).toHaveBeenCalledTimes(2);
  } finally {
    next.client.persistence!.dispose();
  }
});

test('a narrower read after invalidation does not wait for an older scalar fetch', async () => {
  const { client, fetchById } = setup();
  const { post: postRef } = await client.request(post);
  const older = Promise.withResolvers<Awaited<ReturnType<typeof fetchById>>>();
  fetchById.mockReturnValueOnce(older.promise);
  const pending = client.request(post, { mode: 'network-only' });
  await client.mutations.addComment({ input: { postId: '1' }, invalidate: [postRef] });
  fetchById.mockResolvedValueOnce([{ id: '1', title: 'Fresh' }]);
  const latest = client.request(title);
  expect(fetchById).toHaveBeenCalledTimes(3);
  await latest;
  older.resolve([{ id: '1', title: 'Older' }]);
  await pending;
  expect(client.store.read('Post:1')?.title).toBe('Fresh');
});

test('invalidating a partially restored record keeps other saved fields readable', async () => {
  const storage = memoryStorage();
  const create = () => setup(createPersistence({ key: 'posts', online: () => true, storage }));
  const first = create();
  try {
    await first.client.request(post);
    await first.client.persistence!.flush();
  } finally {
    first.client.persistence!.dispose();
  }

  const second = create();
  try {
    const { post: postRef } = await second.client.request(title);
    expect(second.fetchById).not.toHaveBeenCalled();
    expect(second.client.store.read('Post:1')?.content).toBeUndefined();
    await second.client.mutations.addComment({
      input: { postId: '1' },
      invalidate: [postRef],
      persist: false,
    });
    await second.client.persistence!.flush();
  } finally {
    second.client.persistence!.dispose();
  }

  const next = create();
  try {
    const response = Promise.withResolvers<Awaited<ReturnType<typeof next.fetchById>>>();
    next.fetchById.mockReturnValueOnce(response.promise);
    const refresh = next.client.request(content);
    await vi.waitFor(() => expect(next.fetchById).toHaveBeenCalledTimes(1));
    expect(
      next.client.observeRequest(content, { mode: 'cache-only' }).getSnapshot().data?.post.id,
    ).toBe('1');
    expect(next.client.store.read('Post:1')?.content).toBe('Content');
    response.resolve([{ content: 'Fresh content', id: '1' }]);
    await refresh;
  } finally {
    next.client.persistence!.dispose();
  }
});

test('an older nullable query cannot hide a record invalidated while the query was pending', async () => {
  const { client, fetchQuery } = setup();
  const query = { post: { view: Title } };
  const { post: postRef } = await client.request(query);
  const older = Promise.withResolvers<null>();
  fetchQuery.mockReturnValueOnce(older.promise);
  const pending = client.request(query, { mode: 'network-only' });
  await client.mutations.addComment({ input: { postId: '1' }, invalidate: [postRef!] });
  older.resolve(null);
  await pending;

  expect(client.getRequestResult(query).post?.id).toBe('1');
  await client.request(query);
  expect(fetchQuery).toHaveBeenCalledTimes(3);
});

test('a partial refresh clears its part of an invalidated embedded object', async () => {
  type PostWithDetails = Post & { details: { count: number; summary: string } };
  const Summary = view<PostWithDetails>()({ details: { summary: true } });
  const Count = view<PostWithDetails>()({ details: { count: true } });
  const fetchById = vi.fn().mockResolvedValue([{ details: { count: 1, summary: 'Old' }, id: '1' }]);
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport: { fetchById, mutate: vi.fn().mockResolvedValue({ id: 'comment' }) },
    types: [{ fields: { details: { embedded: 'Details' } }, type: 'Post' }, { type: 'Comment' }],
  });
  client.write('Post', { details: { count: 1, summary: 'Old' }, id: '1' }, new Set(['details']));
  const postRef = client.ref('Post', '1', Summary);
  await client.mutations.addComment({ input: { postId: '1' }, invalidate: [postRef] });

  const summary = { post: { id: '1', view: Summary } };
  fetchById.mockResolvedValueOnce([{ details: { summary: 'Fresh' }, id: '1' }]);
  await client.request(summary);
  await client.request(summary);
  expect(fetchById).toHaveBeenCalledTimes(1);
  expect(client.store.read('Post:1')?.details).toEqual({ count: 1, summary: 'Fresh' });

  fetchById.mockResolvedValueOnce([{ details: { count: 2 }, id: '1' }]);
  await client.request({ post: { id: '1', view: Count } });
  expect(fetchById).toHaveBeenCalledTimes(2);
  expect(client.store.read('Post:1')?.details).toEqual({ count: 2, summary: 'Fresh' });
});

test('saving a record invalidation preserves its normalized links', async () => {
  type Author = { __typename: 'Author'; id: string; name: string };
  type PostWithAuthor = Post & { author: Author };
  const Byline = view<PostWithAuthor>()({ author: { name: true } });
  const request = { post: { id: '1', view: Byline } };
  const record = { author: { id: 'a', name: 'Ada' }, id: '1' };
  const storage = memoryStorage();
  const create = () => {
    const fetchById = vi.fn(async () => [record]);
    const client = createClient<[typeof roots, typeof mutations]>({
      mutations,
      persistence: createPersistence({ key: 'byline', storage }),
      roots,
      transport: { fetchById, mutate: vi.fn().mockResolvedValue({ id: 'comment' }) },
      types: [
        { fields: { author: { type: 'Author' } }, type: 'Post' },
        { type: 'Author' },
        { type: 'Comment' },
      ],
    });
    return { client, fetchById };
  };

  const first = create();
  try {
    const { post: postRef } = await first.client.request(request);
    await first.client.persistence!.flush();
    await first.client.mutations.addComment({
      input: { postId: '1' },
      invalidate: [postRef],
      persist: false,
    });
    await first.client.persistence!.flush();
  } finally {
    first.client.persistence!.dispose();
  }

  const next = create();
  try {
    const response = Promise.withResolvers<Array<typeof record>>();
    next.fetchById.mockReturnValueOnce(response.promise);
    const refresh = next.client.request(request);
    await vi.waitFor(() => expect(next.fetchById).toHaveBeenCalledTimes(1));
    expect(
      next.client.observeRequest(request, { mode: 'cache-only' }).getSnapshot().data?.post.id,
    ).toBe('1');
    expect(isNodeRef(next.client.store.read('Post:1')?.author)).toBe(true);
    response.resolve([record]);
    await refresh;
  } finally {
    next.client.persistence!.dispose();
  }
});
