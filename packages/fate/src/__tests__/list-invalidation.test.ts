import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { mutation } from '../mutation.ts';
import { createPersistence } from '../persistence.ts';
import { clientRoot } from '../root.ts';
import type { SelectionOf } from '../types.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

type Post = { __typename: 'Post'; id: string; title: string };
type Folder = { __typename: 'Folder'; id: string; posts: Array<Post> };
const PostView = view<Post>()({ title: true });
const FolderView = view<Folder>()({ posts: PostView });
const roots = {
  folder: clientRoot('Folder'),
  posts: clientRoot<Array<Post>, 'Post'>('Post'),
};
const mutations = { add: mutation<Post, { title: string }, Post>('Post') };
const feed = (category: string) => ({
  posts: { args: { category, first: 1 }, list: { items: { node: PostView } } },
});
const active = feed('active');
const archived = feed('archived');
const folder = { folder: { id: 'folder', view: FolderView } };
const page = (id: string) => ({
  items: [{ cursor: id, node: { id, title: id } }],
  pagination: { hasNext: true, hasPrevious: false, nextCursor: id },
});

const setup = (persistence?: ReturnType<typeof createPersistence>) => {
  const fetchList = vi.fn(
    async (
      _name: string,
      _selection: Set<string>,
      args?: object,
    ): Promise<ReturnType<typeof page> | null> =>
      page(args && 'category' in args ? String(args.category) : 'old'),
  );
  const fetchById = vi.fn(async () => [{ id: 'folder', posts: [{ id: 'old', title: 'Old' }] }]);
  const mutate = vi.fn().mockResolvedValue({ __typename: 'Post', id: 'new', title: 'New' });
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    persistence,
    roots,
    transport: { fetchById, fetchList, mutate, mutateDurably: mutate },
    types: [
      { fields: { posts: { listOf: 'Post' } }, type: 'Folder' },
      { fields: { title: 'scalar' }, type: 'Post' },
    ],
  });
  return { client, fetchById, fetchList, mutate };
};

test('a confirmed mutation invalidates only the targeted list and keeps its snapshot readable', async () => {
  const { client, fetchList, mutate } = setup();
  const { posts } = await client.request(active);
  await client.request(archived);
  const confirmation = Promise.withResolvers<Post>();
  mutate.mockReturnValueOnce(confirmation.promise);
  const pending = client.actions.add(null, { input: { title: 'New' }, invalidate: [posts] });
  await client.request(active);
  expect(fetchList).toHaveBeenCalledTimes(2);

  confirmation.resolve({ __typename: 'Post' as const, id: 'new', title: 'New' });
  await pending;
  expect(
    client.observeRequest(active, { mode: 'cache-only' }).getSnapshot().data?.posts.items[0].node
      .id,
  ).toBe('active');
  expect(fetchList).toHaveBeenCalledTimes(2);

  fetchList.mockResolvedValueOnce(page('new'));
  await client.request(archived);
  expect((await client.request(active)).posts.items[0].node.id).toBe('new');
  await client.request(active);
  expect(fetchList).toHaveBeenCalledTimes(3);
});

test('a failed mutation leaves the targeted list fresh', async () => {
  const { client, fetchList, mutate } = setup();
  const { posts } = await client.request(active);
  mutate.mockRejectedValueOnce(new Error('mutation failed'));
  await expect(
    client.mutations.add({ input: { title: 'New' }, invalidate: [posts] }),
  ).rejects.toThrow('mutation failed');
  await client.request(active);
  expect(fetchList).toHaveBeenCalledTimes(1);
});

test('older responses, later pages, and failed refreshes leave the first page stale', async () => {
  const { client, fetchList } = setup();
  const { posts } = await client.request(active);
  const older = Promise.withResolvers<ReturnType<typeof page>>();
  fetchList.mockReturnValueOnce(older.promise);
  const pending = client.request(active, { mode: 'network-only' });
  await client.mutations.add({ input: { title: 'New' }, invalidate: [posts] });
  older.resolve(page('older'));
  await pending;
  expect(client.getRequestResult(active).posts.items[0].node.id).toBe('active');

  const continuation = {
    posts: { ...active.posts, args: { ...active.posts.args, after: 'active' } },
  };
  fetchList.mockResolvedValueOnce(page('later')).mockResolvedValueOnce(null);
  await client.request(continuation, { mode: 'network-only' });
  await client.request(continuation, { mode: 'network-only' });
  fetchList.mockRejectedValueOnce(new Error('refresh failed'));
  await expect(client.request(active)).rejects.toThrow('refresh failed');
  expect(client.getRequestResult(active).posts.items[0].node.id).toBe('active');

  fetchList.mockResolvedValueOnce(page('new'));
  expect((await client.request(active)).posts.items[0].node.id).toBe('new');
  await client.request(active);
  expect(fetchList).toHaveBeenCalledTimes(6);
});

test('a cache-first request refreshes a stale nested list', async () => {
  const { client, fetchById } = setup();
  const { folder: ref } = await client.request(folder);
  const { data } = await client.readView<Folder, SelectionOf<typeof FolderView>, typeof FolderView>(
    FolderView,
    ref,
  );
  await client.mutations.add({ input: { title: 'New' }, invalidate: [data.posts] });
  expect(
    (
      await client.readView<Folder, SelectionOf<typeof FolderView>, typeof FolderView>(
        FolderView,
        ref,
      )
    ).data.posts[0].id,
  ).toBe('old');
  fetchById.mockResolvedValueOnce([{ id: 'folder', posts: [{ id: 'new', title: 'New' }] }]);
  await client.request(folder);
  expect(
    (
      await client.readView<Folder, SelectionOf<typeof FolderView>, typeof FolderView>(
        FolderView,
        ref,
      )
    ).data.posts[0].id,
  ).toBe('new');
  await client.request(folder);
  expect(fetchById).toHaveBeenCalledTimes(2);
});

test('a replayed offline mutation invalidates its list on disk', async () => {
  const storage = memoryStorage();
  const create = (online: boolean) =>
    setup(createPersistence({ key: 'lists', online: () => online, storage }));
  const first = create(false);
  const { posts } = await first.client.request(active);
  await first.client.persistence!.flush();
  const pending = first.client.mutations
    .add({ input: { title: 'New' }, invalidate: [posts] })
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
    next.fetchList.mockResolvedValueOnce(page('new'));
    expect((await next.client.request(active)).posts.items[0].node.id).toBe('new');
    expect(next.fetchList).toHaveBeenCalledTimes(1);
  } finally {
    next.client.persistence!.dispose();
  }
});
