import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { mutation } from '../mutation.ts';
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
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    persistence,
    roots,
    transport: { fetchById, mutate, mutateDurably: mutate },
    types: [{ type: 'Post' }, { type: 'Comment' }],
  });
  return { client, fetchById, mutate };
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
