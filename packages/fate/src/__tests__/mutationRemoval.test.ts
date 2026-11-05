import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { defer } from '../defer.ts';
import { mutation, valueMutation } from '../mutation.ts';
import { createPersistence } from '../persistence.ts';
import { FateRequestError } from '../protocol.ts';
import { clientRoot } from '../root.ts';
import { ConnectionTag, type ConnectionMetadata, type SelectionOf } from '../types.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

type Post = { __typename: 'Post'; archived: boolean; id: string; title: string };
type Folder = { __typename: 'Folder'; id: string; posts: Array<Post> };
const PostView = view<Post>()({ archived: true, title: true });
const FolderView = view<Folder>()({ posts: PostView });
const DeferredFolderView = view<Folder>()({ posts: defer({ items: { node: PostView } }) });
const roots = { folder: clientRoot('Folder'), posts: clientRoot('Post') };
const mutations = {
  archive: mutation<Post, { id: string }, Post>('Post'),
  dismiss: valueMutation<{ id: string }, boolean>(),
};
const inbox = { posts: { args: { category: 'inbox' }, list: PostView } };
const starred = { posts: { args: { category: 'starred' }, list: PostView } };
const archive = { posts: { args: { category: 'archive' }, list: PostView } };
const folder = { folder: { id: 'folder', view: FolderView } };
const post = (id: string) => ({ archived: false, id, title: id });
const page = (...ids: Array<string>) => ({
  items: ids.map((id) => ({ cursor: id, node: post(id) })),
  pagination: { hasNext: false, hasPrevious: false, nextCursor: undefined as string | undefined },
});

function setup(persistence?: ReturnType<typeof createPersistence>) {
  const fetchList = vi.fn(
    async (_name: string, _fields: Set<string>, args?: { category?: string }) =>
      args?.category === 'archive' ? page() : page('1', '2'),
  );
  const fetchById = vi.fn(async () => [{ id: 'folder', posts: [post('1'), post('2')] }]);
  const mutate = vi.fn().mockResolvedValue({ ...post('1'), archived: true });
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    persistence,
    roots,
    transport: { fetchById, fetchList, mutate, mutateDurably: mutate },
    types: [{ fields: { posts: { listOf: 'Post' } }, type: 'Folder' }, { type: 'Post' }],
  });
  const ids = (request: typeof inbox) => client.getRequestResult(request).posts.map(({ id }) => id);
  return { client, fetchById, fetchList, ids, mutate };
}

test('an action can remove several memberships and insert into another list atomically', async () => {
  const { client, ids, mutate } = setup();
  const { posts } = await client.request(inbox);
  const { posts: other } = await client.request(starred);
  const { posts: archived } = await client.request(archive);
  const response = Promise.withResolvers<unknown>();
  mutate.mockReturnValueOnce(response.promise);
  const node = posts[0];
  const first = { from: posts, node };
  const pending = client.actions.archive(null, {
    input: { id: '1' },
    insert: { into: archived, position: 'before' },
    optimistic: { archived: true },
    remove: [first, { from: other, node }, { from: posts, node: posts[1] }, first],
    view: PostView,
  });

  expect(ids(inbox)).toEqual([]);
  expect(ids(starred)).toEqual(['2']);
  expect(ids(archive)).toEqual(['1']);
  expect(client.store.read('Post:1')).toMatchObject({ archived: true, title: '1' });

  response.resolve({ ...post('1'), archived: true });
  await pending;
  expect(ids(inbox)).toEqual([]);
  expect(ids(starred)).toEqual(['2']);
  expect(ids(archive)).toEqual(['1']);
  expect(client.store.read('Post:2')?.title).toBe('2');
});

test('rejecting a value mutation restores only its removal over the latest page', async () => {
  const { client, fetchList, ids, mutate } = setup();
  const { posts } = await client.request(inbox);
  const response = Promise.withResolvers<boolean>();
  mutate.mockReturnValueOnce(response.promise);
  const pending = client.mutations.dismiss({
    input: { id: '1' },
    remove: { from: posts, node: posts[0] },
  });
  expect(ids(inbox)).toEqual(['2']);

  fetchList.mockResolvedValueOnce(page('1', '2', '3'));
  await client.request(inbox, { mode: 'network-only' });
  expect(ids(inbox)).toEqual(['2', '3']);

  const rejected = expect(pending).rejects.toThrow('dismiss failed');
  response.reject(new Error('dismiss failed'));
  await rejected;
  expect(ids(inbox)).toEqual(['1', '2', '3']);
});

test('an older page cannot reintroduce a confirmed removal from outside the loaded page', async () => {
  const { client, fetchList, ids, mutate } = setup();
  const { posts } = await client.request(inbox);
  const older = Promise.withResolvers<ReturnType<typeof page>>();
  fetchList.mockReturnValueOnce(older.promise);
  const pending = client.request(inbox, { mode: 'network-only' });
  mutate.mockResolvedValueOnce(true);
  await client.mutations.dismiss({
    input: { id: '3' },
    remove: { from: posts, node: client.ref('Post', '3', PostView) },
  });
  older.resolve(page('1', '2', '3'));
  await pending;
  expect(ids(inbox)).toEqual(['1', '2']);

  fetchList.mockResolvedValueOnce(page('1', '2', '3'));
  await client.request(inbox, { mode: 'network-only' });
  expect(ids(inbox)).toEqual(['1', '2', '3']);
});

test('a late nested response preserves a scoped removal and unrelated fields', async () => {
  const { client, fetchById, mutate } = setup();
  const { folder: ref } = await client.request(folder);
  const read = () =>
    client.readView<Folder, SelectionOf<typeof FolderView>, typeof FolderView>(FolderView, ref);
  const { data } = await read();
  const older = Promise.withResolvers<Awaited<ReturnType<typeof fetchById>>>();
  fetchById.mockReturnValueOnce(older.promise);
  const pending = client.request(folder, { mode: 'network-only' });
  mutate.mockResolvedValueOnce(true);
  await client.mutations.dismiss({
    input: { id: '1' },
    remove: { from: data.posts, node: data.posts[0] },
  });
  older.resolve([{ id: 'folder', posts: [post('1'), { ...post('2'), title: 'Newer title' }] }]);
  await pending;
  expect((await read()).data.posts.map(({ id }) => id)).toEqual(['2']);
  expect(client.store.read('Post:2')?.title).toBe('Newer title');
  expect(client.store.read('Post:1')?.title).toBe('1');
});

test('a deferred list can be targeted before it is loaded', async () => {
  const { client, fetchById, mutate } = setup();
  const ref = client.ref('Folder', 'folder', DeferredFolderView);
  client.write('Folder', { id: 'folder' }, new Set(['id']));
  const { data } = await client.readView<
    Folder,
    SelectionOf<typeof DeferredFolderView>,
    typeof DeferredFolderView
  >(DeferredFolderView, ref);
  const response = Promise.withResolvers<boolean>();
  mutate.mockReturnValueOnce(response.promise);
  const pending = client.mutations.dismiss({
    input: { id: '1' },
    remove: { from: data.posts, node: client.ref('Post', '1', PostView) },
  });
  expect(fetchById).not.toHaveBeenCalled();
  const { data: connection } = await client.readDeferred(data.posts);
  expect(connection.items.map(({ node }) => node.id)).toEqual(['2']);
  response.resolve(true);
  await pending;
});

test('a foreign list or a mismatched node is rejected before delivery', async () => {
  const { client, mutate } = setup();
  const foreign = await setup().client.request(inbox);
  const { posts } = await client.request(inbox);
  await expect(
    client.mutations.dismiss({
      input: { id: '1' },
      remove: { from: foreign.posts, node: posts[0] },
    }),
  ).rejects.toThrow('Removal requires a list returned by this client');
  await expect(
    client.mutations.dismiss({
      input: { id: '1' },
      remove: { from: posts, node: client.ref('Folder', 'folder', FolderView) },
    }),
  ).rejects.toThrow("Cannot remove 'Folder' from a 'Post' list");
  expect(mutate).not.toHaveBeenCalled();
});

test.each([true, false])(
  'offline replay restores and settles scoped removals (success: %s)',
  async (success) => {
    const storage = memoryStorage();
    let online = false;
    const create = () =>
      setup(createPersistence({ key: 'removal', online: () => online, storage }));
    const first = create();
    const { posts } = await first.client.request(inbox);
    await first.client.request(starred);
    await first.client.persistence!.flush();
    const submission = first.client.mutations
      .dismiss({
        input: { id: '1' },
        remove: [{ from: posts, node: posts[0] }],
      })
      .catch(() => {});
    try {
      await vi.waitFor(() =>
        expect(first.client.persistence!.getSnapshot().mutations).toHaveLength(1),
      );
      expect(first.ids(inbox)).toEqual(['2']);
      await first.client.persistence!.flush();
    } finally {
      first.client.persistence!.dispose();
      await submission;
    }

    const next = create();
    try {
      await next.client.persistence!.ready;
      expect(next.ids(inbox)).toEqual(['2']);
      await next.client.request(starred);
      expect(next.ids(starred)).toEqual(['1', '2']);
      if (success) {
        next.mutate.mockResolvedValueOnce(true);
      } else {
        next.mutate.mockRejectedValueOnce(new FateRequestError('BAD_REQUEST', 'Refused'));
      }
      online = true;
      next.client.persistence!.retry();
      await vi.waitFor(() => {
        const mutations = next.client.persistence!.getSnapshot().mutations;
        if (success) {
          expect(mutations).toHaveLength(0);
        } else {
          expect(mutations[0]?.status).toBe('failed');
        }
      });
      expect(next.ids(inbox)).toEqual(success ? ['2'] : ['1', '2']);
      await next.client.persistence!.flush();
    } finally {
      next.client.persistence!.dispose();
    }

    const fresh = create();
    try {
      await fresh.client.request(inbox);
      expect(fresh.ids(inbox)).toEqual(success ? ['2'] : ['1', '2']);
      expect(fresh.fetchList).not.toHaveBeenCalled();
    } finally {
      fresh.client.persistence!.dispose();
    }
  },
);

test('a cursor page in flight cannot put a removed node back', async () => {
  const { client, fetchList, mutate } = setup();
  fetchList.mockResolvedValueOnce({
    ...page('1', '2'),
    pagination: { hasNext: true, hasPrevious: false, nextCursor: '2' },
  });
  const request = { posts: { list: { args: { first: 2 }, items: { node: PostView } } } };
  const { posts } = await client.request(request);
  const connection = (posts as typeof posts & { [ConnectionTag]: ConnectionMetadata })[
    ConnectionTag
  ];
  const older = Promise.withResolvers<ReturnType<typeof page>>();
  fetchList.mockReturnValueOnce(older.promise);
  const pending = client.loadConnection(PostView, connection, { after: '2', first: 2 });
  mutate.mockResolvedValueOnce(true);
  await client.mutations.dismiss({
    input: { id: '1' },
    remove: { from: posts, node: posts.items[0].node },
  });
  older.resolve(page('1', '3'));
  await pending;
  expect(client.getRequestResult(request).posts.items.map(({ node }) => node.id)).toEqual(['2']);
});
