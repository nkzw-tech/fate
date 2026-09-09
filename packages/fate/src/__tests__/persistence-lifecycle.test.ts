import { afterEach, expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { mutation } from '../mutation.ts';
import type { PersistenceSession } from '../persistence-types.ts';
import { createPersistence } from '../persistence.ts';
import { clientRoot } from '../root.ts';
import type { Transport } from '../transport.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

type Author = { __typename: 'Author'; id: string; name: string };
type Post = { __typename: 'Post'; author: Author; id: string; title: string };
const AuthorView = view<Author>()({ id: true, name: true });
const PostView = view<Post>()({ author: AuthorView, id: true, title: true });
const page = {
  posts: {
    list: {
      items: { cursor: true, node: PostView },
      pagination: { hasNext: true, hasPrevious: true },
    },
  },
};
const sessions: Array<PersistenceSession> = [];
afterEach(() => {
  for (const session of sessions.splice(0)) {
    session.dispose();
  }
  vi.restoreAllMocks();
});
const setup = (storage = memoryStorage(), online = false) => {
  const roots = { post: clientRoot('Post'), posts: clientRoot('Post') };
  const fetchById = vi.fn(async () => [
    {
      __typename: 'Post',
      author: { __typename: 'Author', id: 'a', name: 'Old author' },
      id: '1',
      title: 'Old',
    },
  ]);
  const fetchList = vi.fn(async () => ({
    items: [{ cursor: 'cursor-1', node: (await fetchById())[0] }],
    pagination: { hasNext: false, hasPrevious: false },
  }));
  const unsubscribe = vi.fn();
  const subscribeById = vi.fn<NonNullable<Transport['subscribeById']>>(() => unsubscribe);
  const subscribeConnection = vi.fn<NonNullable<Transport['subscribeConnection']>>(
    () => unsubscribe,
  );
  const mutations = { edit: mutation<Post, { id: string; title: string }, Post | null>('Post') };
  const mutate = vi.fn(async (): Promise<any> => null);
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    persistence: createPersistence({ key: 'lifecycle', online: () => online, storage }),
    roots,
    transport: {
      fetchById,
      fetchList,
      mutate,
      mutateDurably: mutate,
      subscribeById,
      subscribeConnection,
    },
    types: [
      { fields: { author: { type: 'Author' }, title: 'scalar' }, type: 'Post' },
      { fields: { name: 'scalar' }, type: 'Author' },
    ],
  });
  sessions.push(client.persistence!);
  const add = (id: string) =>
    client.write(
      'Post',
      {
        author: { __typename: 'Author', id: `author-${id}`, name: id },
        id,
        title: id,
      },
      new Set(['id', 'title', 'author.id', 'author.name']),
      undefined,
      'after',
    );
  return {
    add,
    client,
    fetchById,
    fetchList,
    mutate,
    session: client.persistence!,
    storage,
    subscribeById,
    subscribeConnection,
    unsubscribe,
  };
};

test('relationship metadata rebuilds roots only when referenced IDs change', async () => {
  const current = setup();
  const retain = current.client.retain(page);
  await current.client.request(page);
  await current.session.flush();
  const writes = vi.spyOn(current.storage, 'writeBatch');
  current.client.write(
    'Post',
    {
      author: { __typename: 'Author', id: 'a', name: 'Updated author' },
      id: '1',
    },
    new Set(['id', 'author.id', 'author.name']),
  );
  await current.session.flush();
  let keys = writes.mock.calls.flatMap(([entries]) => entries.map(([key]) => key));
  expect(keys.some((key) => key.includes(':root:'))).toBe(false);
  writes.mockClear();
  current.client.write(
    'Post',
    {
      author: { __typename: 'Author', id: 'b', name: 'New author' },
      id: '1',
    },
    new Set(['id', 'author.id', 'author.name']),
  );
  await current.session.flush();
  keys = writes.mock.calls.flatMap(([entries]) => entries.map(([key]) => key));
  expect(keys.some((key) => key.includes(':root:'))).toBe(true);
  retain.dispose();
});

test.each(['update', 'delete', 'insert', 'remove edge'] as const)(
  'stale-tab list edits preserve another tab’s %s through reload',
  async (change) => {
    const first = setup();
    await first.client.request(page);
    await first.session.flush();
    const stale = setup(first.storage);
    await stale.client.request(page);
    await stale.session.flush();
    if (change === 'update') {
      first.client.write('Author', { id: 'a', name: 'New author' }, new Set(['id', 'name']));
    }
    if (change === 'delete') {
      first.client.deleteRecord('Post', '1');
    }
    if (change === 'insert') {
      first.add('3');
    }
    if (change === 'remove edge') {
      const [key, list] = first.client.store.dehydrate().lists[0];
      first.client.store.setList(key, { ...list, cursors: [], ids: [] });
    }
    await first.session.flush();
    stale.add('2');
    await stale.session.flush();
    const next = setup(first.storage);
    await next.client.request(page);
    expect(next.fetchList).not.toHaveBeenCalled();
    const list = next.client.store.dehydrate().lists[0][1];
    expect(list.ids).toEqual(
      change === 'delete' || change === 'remove edge'
        ? ['Post:2']
        : change === 'insert'
          ? ['Post:1', 'Post:3', 'Post:2']
          : ['Post:1', 'Post:2'],
    );
    if (change === 'update') {
      expect(next.client.store.read('Author:a')?.name).toBe('New author');
    }
    if (change === 'delete') {
      expect(next.client.store.read('Post:1')).toBeUndefined();
    }
    if (change === 'update' || change === 'insert') {
      expect(list.cursors?.[0]).toBe('cursor-1');
    }
  },
);

test('disposal rejects new requests before starting transport work', async () => {
  const { client, fetchById, session } = setup();
  await session.ready;
  session.dispose();
  await expect(async () =>
    client.request({ post: { id: '1', view: PostView } }, { mode: 'network-only' }),
  ).rejects.toThrow('disposed');
  expect(fetchById).not.toHaveBeenCalled();
});

test('clearing a disposed session does not delete its saved cache', async () => {
  const { client, session, storage } = setup();
  await client.request({ post: { id: '1', view: PostView } });
  await session.flush();
  const prefix = `${JSON.stringify(['lifecycle', 'cache-v2'])}:`;
  const before = await storage.scan(prefix, undefined, 100);
  session.dispose();
  await expect(session.clearCache()).rejects.toThrow('disposed');
  expect(await storage.scan(prefix, undefined, 100)).toEqual(before);
});

test.each(['node', 'list'] as const)(
  'disposal rejects an in-flight %s and ignores its late response',
  async (kind) => {
    const { client, fetchById, session } = setup();
    await session.ready;
    let complete!: (value: Awaited<ReturnType<typeof fetchById>>) => void;
    fetchById.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const request = client.request(kind === 'node' ? { post: { id: '1', view: PostView } } : page, {
      mode: 'network-only',
    });
    const rejected = expect(request).rejects.toThrow('disposed');
    await vi.waitFor(() => expect(fetchById).toHaveBeenCalled());
    session.dispose();
    await rejected;
    complete([
      {
        __typename: 'Post',
        author: { __typename: 'Author', id: 'a', name: 'Late' },
        id: '1',
        title: 'Late',
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.store.dehydrate().records).toEqual([]);
    expect(client.store.dehydrate().lists).toEqual([]);
  },
);

test('a live session cannot resurrect a confirmed deletion after a cache write fails', async () => {
  const current = setup(undefined, true);
  const request = { post: { id: '1', view: PostView } };
  await current.client.request(request);
  await current.session.flush();
  const writeBatch = current.storage.writeBatch;
  current.storage.writeBatch = async (entries) => {
    if (entries.some(([key]) => key.startsWith('["lifecycle","cache-v2"]:'))) {
      throw new Error('Cache unavailable');
    }
    await writeBatch(entries);
  };
  current.fetchById.mockRejectedValue(new TypeError('Offline'));
  await current.client.mutations.edit({ delete: true, input: { id: '1', title: '' } });
  expect(current.client.store.read('Post:1')).toBeUndefined();
  await expect(current.session.flush()).rejects.toThrow('Cache unavailable');
  await expect(current.client.request(request)).rejects.toThrow('Offline');
  expect(current.client.store.read('Post:1')).toBeUndefined();
  current.storage.writeBatch = writeBatch;
  await current.session.flush();
  const next = setup(current.storage);
  next.fetchById.mockRejectedValue(new TypeError('Offline'));
  await expect(next.client.request(request)).rejects.toThrow('Offline');
  expect(next.client.store.read('Post:1')).toBeUndefined();
});

test.each([false, true])(
  'disposal rejects pending mutations and rolls back optimism (persist=%s)',
  async (persist) => {
    const current = setup(undefined, true);
    await current.client.request({ post: { id: '1', view: PostView } });
    await current.session.flush();
    const response = Promise.withResolvers<Post | null>();
    current.mutate.mockImplementation(() => response.promise);
    const pending = current.client.mutations.edit({
      input: { id: '1', title: 'New' },
      optimistic: { title: 'New' },
      persist,
    });
    const rejected = expect(pending).rejects.toThrow('disposed');
    await vi.waitFor(() => expect(current.mutate).toHaveBeenCalled());
    expect(current.client.store.read('Post:1')?.title).toBe('New');
    current.session.dispose();
    await rejected;
    response.resolve({
      __typename: 'Post',
      author: { __typename: 'Author', id: 'a', name: 'Late' },
      id: '1',
      title: 'Late',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(current.client.store.read('Post:1')?.title).toBe('Old');
  },
);

test('confirmed list deltas survive a failed flush and recovery in a new client', async () => {
  const first = setup();
  await first.client.request(page);
  await first.session.flush();
  const stale = setup(first.storage, true);
  await stale.client.request(page);
  await stale.session.flush();
  first.client.deleteRecord('Post', '1');
  await first.session.flush();
  first.session.dispose();
  stale.mutate.mockResolvedValue({
    __typename: 'Post',
    author: { __typename: 'Author', id: 'b', name: 'New author' },
    id: '2',
    title: 'New',
  });
  const writeBatch = first.storage.writeBatch;
  first.storage.writeBatch = async (entries) => {
    if (entries.some(([key]) => key.startsWith('["lifecycle","cache-v2"]:'))) {
      throw new Error('Cache unavailable');
    }
    await writeBatch(entries);
  };
  await stale.client.mutations.edit({
    input: { id: '2', title: 'New' },
    insert: 'after',
    view: PostView,
  });
  await expect(stale.session.flush()).rejects.toThrow('Cache unavailable');
  stale.session.dispose();
  first.storage.writeBatch = writeBatch;
  const next = setup(first.storage);
  await next.client.request(page);
  expect(next.fetchList).not.toHaveBeenCalled();
  expect(next.client.store.dehydrate().lists[0][1].ids).toEqual(['Post:2']);
  expect(next.client.store.read('Post:1')).toBeUndefined();
  expect(next.client.store.read('Post:2')?.title).toBe('New');
});

test('nested list membership and parent references both preserve another tab’s deletion', async () => {
  type Folder = { __typename: 'Folder'; id: string; posts: Array<Post> };
  const FolderView = view<Folder>()({ id: true, posts: PostView });
  const roots = { folder: clientRoot('Folder') };
  const request = { folder: { id: 'f', view: FolderView } };
  const storage = memoryStorage();
  const post = {
    __typename: 'Post',
    author: { __typename: 'Author', id: 'a', name: 'Author' },
    id: '1',
    title: 'Old',
  };
  const create = () => {
    const fetchById = vi.fn(async () => [{ __typename: 'Folder', id: 'f', posts: [post] }]);
    const client = createClient<[typeof roots, Record<never, never>]>({
      persistence: createPersistence({ key: 'folder', online: () => false, storage }),
      roots,
      transport: { fetchById },
      types: [
        { fields: { posts: { listOf: 'Post' } }, type: 'Folder' },
        { fields: { author: { type: 'Author' }, title: 'scalar' }, type: 'Post' },
        { fields: { name: 'scalar' }, type: 'Author' },
      ],
    });
    sessions.push(client.persistence!);
    return { client, fetchById, session: client.persistence! };
  };
  const first = create();
  await first.client.request(request);
  await first.session.flush();
  const stale = create();
  await stale.client.request(request);
  await stale.session.flush();
  first.client.deleteRecord('Post', '1');
  await first.session.flush();
  stale.client.write(
    'Folder',
    { id: 'f', posts: [post, { ...post, id: '2' }] },
    new Set(['id', 'posts.id', 'posts.title', 'posts.author.id', 'posts.author.name']),
  );
  await stale.session.flush();
  const next = create();
  await next.client.request(request);
  expect(next.fetchById).not.toHaveBeenCalled();
  expect(next.client.store.dehydrate().lists[0][1].ids).toEqual(['Post:2']);
  expect(next.client.store.read('Post:1')).toBeUndefined();
  expect(next.client.store.read('Folder:f')?.posts).toHaveLength(1);
});

test('disposal rejects a request waiting for disk restoration', async () => {
  const first = setup();
  await first.client.request(page);
  await first.session.flush();
  first.session.dispose();
  const next = setup(first.storage);
  await next.session.ready;
  const resume = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const read = first.storage.read;
  first.storage.read = async (key) => {
    if (key.includes(':node:')) {
      started.resolve();
      await resume.promise;
    }
    return read(key);
  };
  const request = next.client.request(page);
  const rejected = expect(request).rejects.toThrow('disposed');
  await started.promise;
  next.session.dispose();
  await rejected;
  resume.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(next.fetchList).not.toHaveBeenCalled();
  expect(next.client.store.dehydrate().records).toEqual([]);
});

test('disposal closes live subscriptions and ignores callbacks from closed transports', async () => {
  const current = setup();
  await current.client.request(page);
  await current.session.flush();
  const ref = current.client.ref<Post>('Post', '1', PostView);
  current.client.subscribeLiveView(PostView, ref);
  current.client.subscribeLiveListView(PostView, {
    field: 'posts',
    key: current.client.store.dehydrate().lists[0][0],
    owner: 'posts',
    procedure: 'posts',
    root: true,
    type: 'Post',
  });
  const nodeHandlers = current.subscribeById.mock.calls[0][4];
  const listHandlers = current.subscribeConnection.mock.calls[0][5];
  current.unsubscribe.mockImplementationOnce(() => {
    throw new Error('Transport cleanup failed');
  });
  current.session.dispose();
  expect(current.unsubscribe).toHaveBeenCalledTimes(2);
  nodeHandlers.onData({ __typename: 'Post', id: '1', title: 'Late' });
  nodeHandlers.onDelete?.('1');
  listHandlers.onEvent({ id: '1', nodeType: 'Post', type: 'deleteEdge' });
  expect(current.client.store.read('Post:1')?.title).toBe('Old');
  expect(current.client.store.dehydrate().lists[0][1].ids).toEqual(['Post:1']);
  expect(() => current.client.subscribeLiveView(PostView, ref)).toThrow('disposed');
});

test('promoting a buffered item in a stale tab cannot resurrect a remote deletion', async () => {
  const first = setup();
  await first.client.request(page);
  const [key, list] = first.client.store.dehydrate().lists[0];
  first.client.store.setList(key, { ...list, cursors: [], ids: [], pendingAfterIds: ['Post:1'] });
  await first.session.flush();
  const stale = setup(first.storage);
  await stale.client.request(page);
  await stale.session.flush();
  first.client.deleteRecord('Post', '1');
  await first.session.flush();
  stale.client.store.setList(key, {
    ...stale.client.store.getListState(key)!,
    ids: ['Post:1'],
    pendingAfterIds: [],
  });
  stale.add('2');
  await stale.session.flush();
  const next = setup(first.storage);
  await next.client.request(page);
  expect(next.fetchList).not.toHaveBeenCalled();
  expect(next.client.store.getListState(key)?.ids).toEqual(['Post:2']);
  expect(next.client.store.read('Post:1')).toBeUndefined();
});
