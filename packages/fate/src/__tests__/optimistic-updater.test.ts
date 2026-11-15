import { describe, expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { createHTTPTransport } from '../httpTransport.ts';
import { decodeClientHydrationState } from '../hydration.ts';
import { mutation, valueMutation } from '../mutation.ts';
import { readOptimisticField, withOptimisticSnapshot } from '../optimistic-snapshot.ts';
import { createPersistence } from '../persistence.ts';
import { clientRoot } from '../root.ts';
import { dataView, list } from '../server/dataView.ts';
import { createSourceRegistry } from '../server/executor.ts';
import { createFateServer } from '../server/http.ts';
import { createLiveEventBus } from '../server/live.ts';
import type { SourceDefinition } from '../server/source.ts';
import type { MutationContext, Transport } from '../transport.ts';
import type { Entity, MutationDefinition } from '../types.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

type Post = { __typename: 'Post'; id: string; likes: number; pinned: boolean };
type Input = { by: number; id: string };
const id = '1';
const PostView = view<Post>()({ id: true, likes: true, pinned: true });
const LikesView = view<Post>()({ id: true, likes: true });
const roots = { post: clientRoot('Post') };
const request = { post: { id, view: PostView } };
const record = (likes: number, pinned = false): Post => ({ __typename: 'Post', id, likes, pinned });
const stats = (comments: number, likes: number) => ({ comments, likes });
const snapshot = (likes: number, revision: number, appliedMutationIds: Array<string> = []) =>
  withOptimisticSnapshot(record(likes), { appliedMutationIds, revision });
const mutations = {
  edit: mutation<Post, Input, Post>('Post', {
    optimistic: (post, input) =>
      post.likes === undefined ? undefined : { likes: post.likes + input.by },
  }),
};
const makeClient = (
  transport: Transport<{ edit: { input: Input; output: Post } }>,
  persistence?: ReturnType<typeof createPersistence>,
) =>
  createClient<[typeof roots, typeof mutations]>({
    mutations,
    persistence,
    roots,
    transport,
    types: [{ type: 'Post' }],
  });

test('legacy optimistic patches can store literal function values without opting in', async () => {
  type PostWithCallback = Post & { callback: () => string };
  const edit = mutation<PostWithCallback, Input, PostWithCallback>('Post');
  const generic: MutationDefinition<Entity, unknown, unknown> = edit;
  expect(generic.entity).toBe('Post');
  const confirmed = { ...record(4), callback: () => 'confirmed' };
  const response = Promise.withResolvers<PostWithCallback>();
  const transport: Transport<{ edit: { input: Input; output: PostWithCallback } }> = {
    fetchById: async () => [],
    mutate: () => response.promise,
  };
  const client = createClient<[typeof roots, { edit: typeof edit }]>({
    mutations: { edit },
    roots,
    transport,
    types: [{ type: 'Post' }],
  });
  client.write('Post', confirmed, new Set(['id', 'callback']));
  const literal = vi.fn(() => 'optimistic');
  const pending = client.mutations.edit({
    input: { by: 1, id },
    optimistic: { callback: literal },
  });
  expect(client.store.read('Post:1')?.callback).toBe(literal);
  expect(literal).not.toHaveBeenCalled();
  response.resolve(confirmed);
  await pending;
});

test('unversioned value mutations preserve cyclic custom transport results', async () => {
  type Payload = { self?: Payload };
  const payload: Payload = {};
  payload.self = payload;
  const take = valueMutation<Record<never, never>, Payload>();
  const transport: Transport<{ take: { input: Record<never, never>; output: Payload } }> = {
    fetchById: async () => [],
    mutate: async () => payload,
  };
  const client = createClient<[Record<never, never>, { take: typeof take }]>({
    mutations: { take },
    roots: {},
    transport,
  });
  const { result } = await client.mutations.take();
  expect(result).toBe(payload);
});

test('a registered updater replays relative changes on an unversioned transport', async () => {
  const reply = Promise.withResolvers<Post>();
  const mutate = vi.fn(() => reply.promise);
  const transport: Transport<{ edit: { input: Input; output: Post } }> = {
    fetchById: async () => [],
    mutate,
  };
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport,
    types: [{ type: 'Post' }],
  });
  const fields = new Set(['id', 'likes', 'pinned']);
  client.write('Post', record(4), fields);
  const pending = client.mutations.edit({ input: { by: 1, id }, optimistic: true });
  expect(mutate).toHaveBeenCalledExactlyOnceWith(
    'edit',
    { by: 1, id },
    new Set(['likes']),
    undefined,
    { mutationId: expect.any(String) },
  );
  client.write('Post', record(5), fields);
  expect(client.store.read('Post:1')?.likes).toBe(6);
  reply.resolve(record(6));
  await pending;
});

test('versioned hydration stores a shared acknowledgement once and restores each field revision', () => {
  const transport = { fetchById: async () => [] };
  const client = makeClient(transport);
  const receipt = 'receipt-shared-by-likes-and-pinned';
  const fields = new Set(['id', 'likes', 'pinned']);
  client.write('Post', snapshot(5, 2, [receipt]), fields);

  const state = client.dehydrate();
  expect(JSON.stringify(state).split(receipt)).toHaveLength(2);
  const restored = makeClient(transport);
  restored.hydrate(state);
  restored.write('Post', withOptimisticSnapshot(record(4, true), { revision: 1 }), fields);
  expect(restored.store.read('Post:1')).toMatchObject({ likes: 5, pinned: false });
});

const makeSnapshotClient = () =>
  createClient({
    roots,
    transport: { fetchById: async () => [] },
    types: [{ fields: { stats: { embedded: 'Stats' } }, type: 'Post' }],
  });

describe.each(['hydrate', 'persistence'] as const)('%s snapshot merging', (mode) => {
  const restore = (
    client: ReturnType<typeof makeSnapshotClient>,
    source: ReturnType<typeof makeSnapshotClient>,
  ) => {
    const state = source.dehydrate();
    if (mode === 'hydrate') {
      client.hydrate(state);
    } else {
      client.restorePersistenceData(decodeClientHydrationState(state.data, undefined, true));
    }
  };

  test('a restored revision applies only to the values restored with it', () => {
    const paths = new Set(['id', 'likes', 'stats.comments', 'stats.likes']);
    const source = makeSnapshotClient();
    source.write(
      'Post',
      withOptimisticSnapshot({ id, likes: 8, stats: stats(8, 8) }, { revision: 8 }),
      paths,
    );
    const client = makeSnapshotClient();
    client.write(
      'Post',
      { id, likes: 4, stats: { likes: 4 } },
      new Set(['id', 'likes', 'stats.likes']),
    );
    restore(client, source);
    expect(client.store.read('Post:1')).toMatchObject({ likes: 4, stats: stats(8, 4) });

    client.write(
      'Post',
      withOptimisticSnapshot({ id, likes: 7, stats: stats(7, 7) }, { revision: 7 }),
      paths,
    );
    expect(client.store.read('Post:1')).toMatchObject({ likes: 7, stats: stats(8, 7) });
  });

  test('a retained revision does not inherit acknowledgements from an older snapshot', () => {
    const paths = new Set(['id', 'likes']);
    const source = makeSnapshotClient();
    source.write(
      'Post',
      withOptimisticSnapshot(
        { id, likes: 7 },
        {
          appliedMutationIds: ['old-receipt'],
          revision: 7,
        },
      ),
      paths,
    );
    const client = makeSnapshotClient();
    client.write('Post', withOptimisticSnapshot({ id, likes: 8 }, { revision: 8 }), paths);
    restore(client, source);

    const cached = client.store.read('Post:1');
    expect(cached?.likes).toBe(8);
    expect(readOptimisticField(cached, 'likes')).toEqual({ revision: 8 });
  });

  test.each([7, 9])(
    'selected omissions keep values and acknowledgements paired when restoring revision %s',
    (revision) => {
      const paths = new Set(['id', 'likes', 'stats.comments']);
      const source = makeSnapshotClient();
      source.write(
        'Post',
        withOptimisticSnapshot(
          { id, likes: revision, pinned: true, stats: { comments: revision } },
          { revision },
        ),
        paths,
      );
      const omission = { appliedMutationIds: ['omitted-fields'], revision: 8 };
      const sparse = makeSnapshotClient();
      sparse.write('Post', withOptimisticSnapshot({ id }, omission), paths);
      const previous = decodeClientHydrationState(sparse.dehydrate().data, undefined, true);
      const [, previousPost] = previous.store.records[0];
      expect(Object.hasOwn(previousPost, 'likes')).toBe(true);
      expect(Object.hasOwn(previousPost, 'stats')).toBe(true);
      // Older snapshots recorded these selections and their revisions without storing the keys.
      delete previousPost.likes;
      delete previousPost.stats;

      const client = makeSnapshotClient();
      client.restorePersistenceData(previous);
      restore(client, source);

      const cached = client.store.read('Post:1');
      expect(cached?.pinned).toBe(true);
      if (mode === 'persistence' && revision > 8) {
        expect(cached).toMatchObject({ likes: revision, stats: { comments: revision } });
        expect(readOptimisticField(cached, 'likes')).toEqual({ revision });
        expect(readOptimisticField(cached, 'stats.comments')).toEqual({ revision });
      } else {
        expect(cached?.likes).toBeUndefined();
        expect(cached?.stats).toBeUndefined();
        expect(readOptimisticField(cached, 'likes')).toEqual(omission);
        expect(readOptimisticField(cached, 'stats.comments')).toEqual(omission);
      }
    },
  );
});

test('field and record updaters compose with an independent live write and roll back in order', async () => {
  const responses = [Promise.withResolvers<Post>(), Promise.withResolvers<Post>()];
  const ids: Array<string> = [];
  let handlers: Parameters<NonNullable<Transport['subscribeById']>>[4];
  const client = makeClient({
    fetchById: async () => [snapshot(4, 1)],
    mutate: vi.fn((_name, _input, _select, _args, context?: MutationContext) => {
      const response = responses[ids.length];
      ids.push(context!.mutationId);
      return response.promise;
    }),
    subscribeById: (_type, _id, _select, _args, events) => {
      handlers = events;
      return () => {};
    },
  });
  await client.request(request);
  const ref = client.ref('Post', id, PostView);
  const data = async () => (await client.readView(PostView, ref)).data;
  const unsubscribe = client.subscribeLiveView(PostView, ref);
  const a = client.mutations.edit({
    input: { by: 1, id },
    optimistic: (post) => (post.likes === undefined ? undefined : { likes: post.likes + 1 }),
  });
  const failed = expect(a).rejects.toThrow('cancelled');
  const b = client.mutations.edit({
    input: { by: 1, id },
    optimistic: (post) => ({ likes: (post.likes ?? 0) + 1, pinned: !post.pinned }),
  });
  expect(await data()).toMatchObject({ likes: 6, pinned: true });
  handlers!.onData(snapshot(5, 2));
  expect(await data()).toMatchObject({ likes: 7, pinned: true });

  responses[0].reject(new Error('cancelled'));
  await failed;
  expect(await data()).toMatchObject({ likes: 6, pinned: true });

  // A partial live payload only acknowledges fields that it actually carries.
  handlers!.onData(
    withOptimisticSnapshot(
      { id, likes: 6 },
      {
        appliedMutationIds: [ids[1]],
        revision: 3,
      },
    ),
    ['id', 'likes'],
  );
  expect(await data()).toMatchObject({ likes: 6, pinned: true });
  responses[1].resolve(
    withOptimisticSnapshot(record(6, true), {
      appliedMutationIds: [ids[1]],
      revision: 3,
    }),
  );
  await expect(b).resolves.toEqual({ error: undefined, result: record(6, true) });
  expect(await data()).toMatchObject({ likes: 6, pinned: true });
  unsubscribe();
});

test('out-of-order confirmation keeps newer snapshots and replays only operations they exclude', async () => {
  const ids: Array<string> = [];
  const responses = [Promise.withResolvers<Post>(), Promise.withResolvers<Post>()];
  let server = snapshot(4, 1);
  const client = makeClient({
    fetchById: async () => [server],
    mutate: (_name, _input, _select, _args, context) => {
      const response = responses[ids.length];
      ids.push(context!.mutationId);
      return response.promise;
    },
  });
  await client.request(request);
  const ref = client.ref('Post', id, PostView);
  const likes = async () => (await client.readView(PostView, ref)).data?.likes;

  const older = client.mutations.edit({ input: { by: 1, id }, optimistic: true });
  const newer = client.mutations.edit({ input: { by: 2, id }, optimistic: true });
  expect(await likes()).toBe(7);

  // The newer operation finishes first. The older increment still belongs on top.
  responses[1].resolve(snapshot(6, 2, [ids[1]]));
  await newer;
  expect(await likes()).toBe(7);

  // A refetch observes both operations, plus an independent increment.
  server = snapshot(8, 4, ids);
  await client.request(request, { mode: 'network-only' });
  expect(await likes()).toBe(8);

  responses[0].resolve(snapshot(7, 3, ids));
  await older;
  expect(await likes()).toBe(8);

  // A later HTTP request may itself return a stale response.
  server = snapshot(7, 3, ids);
  await client.request(request, { mode: 'network-only' });
  expect(await likes()).toBe(8);
});

test('an updater waits for a cached record and requests its explicit view on the mutation', async () => {
  const response = Promise.withResolvers<Post>();
  const update = vi.fn((post: Readonly<Partial<Post>>) =>
    post.likes === undefined ? undefined : { likes: post.likes + 1 },
  );
  const mutate = vi.fn(() => response.promise);
  const client = makeClient({ fetchById: async () => [record(4)], mutate });
  const pending = client.mutations.edit({
    input: { by: 1, id },
    optimistic: update,
    view: LikesView,
  });

  expect(update).not.toHaveBeenCalled();
  expect(mutate.mock.calls[0]).toEqual([
    'edit',
    { by: 1, id },
    new Set(['id', 'likes']),
    undefined,
    { mutationId: expect.any(String) },
  ]);

  await client.request(request);
  const ref = client.ref('Post', id, PostView);
  expect((await client.readView(PostView, ref)).data?.likes).toBe(5);
  response.resolve(record(5));
  await pending;
});

test('a failed replay restores partial writes and still applies later layers', async () => {
  type Person = { __typename: 'Person'; id: string; name: string };
  type Article = Post & { author?: Person; editor?: Person };
  const edit = mutation<Article, Input, Article>('Post');
  const response = Promise.withResolvers<Article>();
  const transport: Transport<{ edit: { input: Input; output: Article } }> = {
    fetchById: async () => [],
    mutate: () => response.promise,
  };
  const client = createClient<[typeof roots, { edit: typeof edit }]>({
    mutations: { edit },
    roots,
    transport,
    types: [
      { fields: { author: { type: 'Person' }, editor: { type: 'Person' } }, type: 'Post' },
      { type: 'Person' },
    ],
  });
  const confirmed = { ...record(4), author: { id: 'a', name: 'Confirmed' } };
  client.write('Post', confirmed, new Set(['id', 'likes', 'pinned', 'author.id', 'author.name']));
  const first = client.mutations.edit({
    input: { by: 1, id },
    optimistic: (current) =>
      current.likes === 5
        ? { author: { id: 'a', name: 'Abandoned' }, editor: { name: 'Missing ID' } }
        : { likes: 10 },
  });
  const second = client.mutations.edit({
    input: { by: 1, id },
    optimistic: (current) => ({ pinned: !current.pinned }),
  });
  expect(client.store.read('Post:1')).toMatchObject({ likes: 10, pinned: true });

  expect(() => client.write('Post', { id, likes: 5 }, new Set(['id', 'likes']))).not.toThrow();
  expect(client.store.read('Post:1')).toMatchObject({ likes: 5, pinned: true });
  expect(client.store.read('Person:a')?.name).toBe('Confirmed');

  response.resolve({ ...record(5), pinned: true });
  await Promise.all([first, second]);
});

test('a partial embedded snapshot acknowledges and orders only the paths it covers', async () => {
  type Article = Post & { stats: { comments: number; likes: number } | null };
  const edit = mutation<Article, Input, Partial<Article>>('Post');
  const response = Promise.withResolvers<Partial<Article>>();
  const appliedMutationIds: Array<string> = [];
  const transport: Transport<{ edit: { input: Input; output: Partial<Article> } }> = {
    fetchById: async () => [],
    mutate: (_name, _input, _select, _args, context) => {
      appliedMutationIds.push(context!.mutationId);
      return response.promise;
    },
  };
  const client = createClient<[typeof roots, { edit: typeof edit }]>({
    mutations: { edit },
    roots,
    transport,
    types: [{ fields: { stats: { embedded: 'Stats' } }, type: 'Post' }],
  });
  const paths = new Set(['id', 'stats.comments', 'stats.likes']);
  client.write('Post', withOptimisticSnapshot({ id, stats: stats(2, 4) }, { revision: 1 }), paths);
  const pending = client.mutations.edit({
    input: { by: 1, id },
    optimistic: (post) => (post.stats ? { stats: { likes: post.stats.likes + 1 } } : undefined),
  });
  expect(client.store.read('Post:1')?.stats).toEqual(stats(2, 5));

  client.write(
    'Post',
    withOptimisticSnapshot({ id, stats: { comments: 3 } }, { appliedMutationIds, revision: 3 }),
    new Set(['id', 'stats.comments']),
  );
  expect(client.store.read('Post:1')?.stats).toEqual(stats(3, 5));
  client.write(
    'Post',
    withOptimisticSnapshot({ id, stats: null }, { revision: 2 }),
    new Set(['id', 'stats']),
  );
  expect(client.store.read('Post:1')?.stats).toEqual(stats(3, 5));

  response.resolve(
    withOptimisticSnapshot({ id, stats: stats(2, 5) }, { appliedMutationIds, revision: 2 }),
  );
  await pending;
  expect(client.store.read('Post:1')?.stats).toEqual(stats(3, 5));
});

test.each([undefined, 3])(
  'a live deletion at revision %s rejects an older receipt and allows a newer record',
  async (revision) => {
    const response = Promise.withResolvers<Post>();
    let handlers: Parameters<NonNullable<Transport['subscribeById']>>[4];
    const client = makeClient({
      fetchById: async () => [snapshot(4, 1)],
      mutate: () => response.promise,
      subscribeById: (_type, _id, _select, _args, events) => {
        handlers = events;
        return () => {};
      },
    });
    await client.request(request);
    const ref = client.ref('Post', id, PostView);
    const unsubscribe = client.subscribeLiveView(PostView, ref);
    const pending = client.mutations.edit({ input: { by: 1, id }, optimistic: true });
    if (revision === undefined) {
      handlers!.onData(snapshot(6, 3));
    }
    handlers!.onDelete?.(id, revision);
    expect(client.store.read('Post:1')).toBeUndefined();

    response.resolve(snapshot(5, 2));
    await pending;
    expect(client.store.read('Post:1')).toBeUndefined();

    handlers!.onData(snapshot(8, 4));
    handlers!.onDelete?.(id, 3);
    expect(client.store.read('Post:1')?.likes).toBe(8);
    unsubscribe();
  },
);

test('a versioned deletion survives reload before the queued mutation receives its receipt', async () => {
  const storage = memoryStorage();
  let online = false;
  const mutateDurably = vi.fn(async () => snapshot(5, 2));
  const reopen = () =>
    makeClient(
      { fetchById: async () => [snapshot(4, 1)], mutateDurably },
      createPersistence({ key: 'optimistic-deletion', online: () => online, storage }),
    );
  let client = reopen();
  try {
    await client.persistence!.ready;
    await client.request(request);
    const pending = client.mutations.edit({
      input: { by: 1, id },
      optimistic: true,
      view: LikesView,
    });
    const disposed = pending.catch(() => undefined);
    await pending.locallyPersisted;
    client.deleteRecord('Post', id, 3);
    await client.persistence!.flush();
    client.persistence!.dispose();
    await disposed;

    client = reopen();
    await client.persistence!.ready;
    expect(client.store.read('Post:1')).toBeUndefined();
    online = true;
    client.persistence!.retry();
    await vi.waitFor(() => expect(client.persistence!.getSnapshot().mutations).toHaveLength(0));
    expect(mutateDurably).toHaveBeenCalledOnce();
    expect(client.store.read('Post:1')).toBeUndefined();
  } finally {
    client.persistence!.dispose();
  }
});

test('a recreated entity rejects omitted fields from its deleted incarnation', () => {
  const transport = { fetchById: async () => [] };
  const client = makeClient(transport);
  client.write('Post', snapshot(4, 1), new Set(['id', 'likes', 'pinned']));
  client.deleteRecord('Post', id, 3);
  client.write(
    'Post',
    withOptimisticSnapshot({ id, likes: 7 }, { revision: 4 }),
    new Set(['id', 'likes']),
  );
  const restored = makeClient(transport);
  restored.hydrate(client.dehydrate());
  restored.write('Post', snapshot(5, 2, []), new Set(['id', 'likes', 'pinned']));
  expect(restored.store.read('Post:1')?.likes).toBe(7);
  expect(restored.store.read('Post:1')?.pinned).toBeUndefined();
});

test.each([undefined, 3])(
  'an ID-only snapshot survives stale deletes after hydration (previous delete: %s)',
  (previousDelete) => {
    const transport = { fetchById: async () => [] };
    const client = makeClient(transport);
    client.write('Post', snapshot(4, 1), new Set(['id', 'likes', 'pinned']));
    if (previousDelete !== undefined) {
      client.deleteRecord('Post', id, previousDelete);
    }
    client.write('Post', withOptimisticSnapshot({ id }, { revision: 4 }), new Set(['id']));

    const restored = makeClient(transport);
    restored.hydrate(client.dehydrate());
    restored.deleteRecord('Post', id, 3);
    expect(restored.store.read('Post:1')).toMatchObject({ id });

    restored.deleteRecord('Post', id, 5);
    expect(restored.store.read('Post:1')).toBeUndefined();
  },
);

test('a stale connection response cannot attach an edge to a recreated entity', async () => {
  let post = snapshot(4, 1);
  const client = createClient({
    roots: { posts: clientRoot<{ items: Array<{ cursor: string; node: Post }> }, 'Post'>('Post') },
    transport: {
      fetchById: async () => [],
      fetchList: async () => ({
        items: [{ cursor: '1', node: post }],
        pagination: { hasNext: false, hasPrevious: false },
      }),
    },
    types: [{ type: 'Post' }],
  });
  const query = { posts: { list: { items: { cursor: true, node: PostView } } } };
  await client.request(query);
  expect(client.getRequestResult(query)).toMatchObject({ posts: { items: [{ cursor: '1' }] } });
  client.deleteRecord('Post', id, 3);

  await client.request(query, { mode: 'network-only' });
  expect(client.getRequestResult(query)).toMatchObject({ posts: { items: [] } });

  client.write('Post', snapshot(7, 4), new Set(['id', 'likes', 'pinned']));
  await client.request(query, { mode: 'network-only' });
  expect(client.getRequestResult(query)).toMatchObject({ posts: { items: [] } });
  expect(client.store.read('Post:1')?.likes).toBe(7);

  post = snapshot(7, 4);
  await client.request(query, { mode: 'network-only' });
  expect(client.getRequestResult(query)).toMatchObject({ posts: { items: [{ cursor: '1' }] } });
});

test.each([2, 4])(
  'a revision-%s mutation receipt only inserts into a scoped list if it matches the incarnation',
  async (revision) => {
    const response = Promise.withResolvers<Post>();
    const listRoots = { posts: clientRoot<Array<Post>, 'Post'>('Post') };
    const transport: Transport<{ edit: { input: Input; output: Post } }> = {
      fetchById: async () => [],
      fetchList: async () => ({ items: [], pagination: { hasNext: false, hasPrevious: false } }),
      mutate: () => response.promise,
    };
    const client = createClient<[typeof listRoots, typeof mutations]>({
      mutations,
      roots: listRoots,
      transport,
      types: [{ type: 'Post' }],
    });
    const query = { posts: { list: { items: { node: PostView } } } };
    const into = (await client.request(query)).posts;
    const fields = new Set(['id', 'likes', 'pinned']);
    client.write('Post', snapshot(4, 1), fields);
    const pending = client.mutations.edit({
      input: { by: 1, id },
      insert: { into, position: 'after' },
    });
    client.deleteRecord('Post', id, 3);
    client.write('Post', snapshot(8, 4), fields);

    response.resolve(snapshot(revision === 4 ? 8 : 5, revision));
    await pending;
    expect(client.store.read('Post:1')?.likes).toBe(8);
    expect(client.getRequestResult(query).posts.items).toHaveLength(revision === 4 ? 1 : 0);
  },
);

test.each([undefined, PostView])(
  'versioned delete receipts respect recreation and can delete a current incarnation (view: %s)',
  async (mutationView) => {
    const older = Promise.withResolvers<Post>();
    const newer = Promise.withResolvers<Post>();
    const mutate = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const client = makeClient({ fetchById: async () => [], mutate });
    const fields = new Set(['id', 'likes', 'pinned']);
    client.write('Post', snapshot(4, 1), fields);
    const deletion = { delete: true, input: { by: 1, id }, view: mutationView } as const;
    const first = client.mutations.edit(deletion);
    client.deleteRecord('Post', id, 3);
    client.write('Post', snapshot(8, 4), fields);
    older.resolve(snapshot(5, 2));
    await first;
    expect(client.store.read('Post:1')?.likes).toBe(8);

    const second = client.mutations.edit(deletion);
    newer.resolve(snapshot(8, 5));
    await second;
    expect(client.store.read('Post:1')).toBeUndefined();
    expect(client.store.deletionRevision('Post:1')).toBe(5);
  },
);

test('stale nested edges cannot point back to deleted or recreated entities', async () => {
  type Person = { __typename: 'Person'; id: string; name: string };
  type Article = Post & { author: Person | null; contributors: Array<Person> };
  const PersonView = view<Person>()({ id: true, name: true });
  const ArticleView = view<Article>()({
    author: PersonView,
    contributors: PersonView,
    id: true,
  });
  const person = withOptimisticSnapshot({ id: 'a', name: 'Author' }, { revision: 1 });
  const client = createClient({
    roots,
    transport: {
      fetchById: async () => [{ ...record(4), author: person, contributors: [person] }],
    },
    types: [
      { fields: { author: { type: 'Person' }, contributors: { listOf: 'Person' } }, type: 'Post' },
      { type: 'Person' },
    ],
  });
  const query = { post: { id, view: ArticleView } };
  await client.request(query);
  client.deleteRecord('Person', 'a', 3);
  expect(client.store.read('Post:1')).toMatchObject({ author: null, contributors: [] });

  await client.request(query, { mode: 'network-only' });
  expect(client.store.read('Post:1')).toMatchObject({ author: null, contributors: [] });

  client.write(
    'Person',
    withOptimisticSnapshot({ id: 'a', name: 'New Author' }, { revision: 4 }),
    new Set(['id', 'name']),
  );
  await client.request(query, { mode: 'network-only' });
  expect(client.store.read('Post:1')).toMatchObject({ author: null, contributors: [] });
  expect(client.store.read('Person:a')?.name).toBe('New Author');
});

test.each(['hydrate', 'persistence'] as const)(
  'restoring an older %s snapshot keeps known deletions out of its relationships',
  async (mode) => {
    const make = () =>
      createClient({
        roots: { posts: clientRoot('Post') },
        transport: {
          fetchById: async () => [],
          fetchList: async () => ({
            items: [{ cursor: '1', node: snapshot(4, 1) }],
            pagination: { hasNext: false, hasPrevious: false },
          }),
        },
        types: [{ fields: { parent: { type: 'Post' } }, type: 'Post' }],
      });
    const query = { posts: { list: { items: { cursor: true, node: PostView } } } };
    const source = make();
    await source.request(query);
    source.write('Post', { id: 'child', parent: snapshot(4, 1) }, new Set(['id', 'parent.id']));
    const saved = source.dehydrate();
    const current = make();
    current.deleteRecord('Post', id, 3);
    if (mode === 'hydrate') {
      current.hydrate(saved);
    } else {
      current.restorePersistenceData(decodeClientHydrationState(saved.data, undefined, true));
    }
    expect(current.store.read('Post:1')).toBeUndefined();
    expect(current.store.read('Post:child')?.parent).toBeNull();
    expect(current.getRequestResult(query)).toMatchObject({ posts: { items: [] } });
  },
);

test('an acknowledgement on a related record stops an updater from applying its change twice', async () => {
  type Person = { __typename: 'Person'; id: string; score: number };
  type Article = Post & { author: Person };
  const edit = mutation<Article, Input, Partial<Article>>('Post');
  const response = Promise.withResolvers<Partial<Article>>();
  const appliedMutationIds: Array<string> = [];
  const transport: Transport<{ edit: { input: Input; output: Partial<Article> } }> = {
    fetchById: async () => [],
    mutate: (_key, _input, _selection, _args, context) => {
      appliedMutationIds.push(context!.mutationId);
      return response.promise;
    },
  };
  const client = createClient<[typeof roots, { edit: typeof edit }]>({
    mutations: { edit },
    roots,
    transport,
    types: [{ fields: { author: { type: 'Person' } }, type: 'Post' }, { type: 'Person' }],
  });
  const paths = new Set(['id', 'author.id', 'author.score']);
  const author = { id: 'a', score: 4 };
  client.write('Post', { author: withOptimisticSnapshot(author, { revision: 1 }), id }, paths);
  const pending = client.mutations.edit({
    input: { by: 1, id },
    optimistic: (post) =>
      post.author && {
        author: { id: post.author.id, score: post.author.score + 1 },
      },
  });
  expect(client.store.read('Person:a')?.score).toBe(5);
  const saved = withOptimisticSnapshot({ id: 'a', score: 5 }, { appliedMutationIds, revision: 2 });
  client.write('Person', saved, new Set(['id', 'score']));
  expect(client.store.read('Person:a')?.score).toBe(5);

  response.resolve({ author: { ...saved, __typename: 'Person' }, id });
  await expect(pending).resolves.toEqual({
    error: undefined,
    result: { author: { __typename: 'Person', id: 'a', score: 5 }, id },
  });
});

test('a registered updater and a live acknowledgement survive offline restart and receipt delivery', async () => {
  const storage = memoryStorage();
  let online = false;
  let server = snapshot(4, 1);
  const mutateDurably = vi.fn(async () => server);
  const makeOffline = () =>
    makeClient(
      { fetchById: async () => [server], mutateDurably },
      createPersistence({ key: 'optimistic-updater', online: () => online, storage }),
    );
  const first = makeOffline();
  let current = first;
  try {
    await first.persistence!.ready;
    await first.request(request);
    const ref = first.ref('Post', id, PostView);
    const pending = first.mutations.edit({
      input: { by: 2, id },
      optimistic: true,
      view: LikesView,
    });
    const disposed = pending.catch(() => undefined);
    await pending.locallyPersisted;
    expect((await first.readView(PostView, ref)).data?.likes).toBe(6);

    server = snapshot(5, 2);
    await first.request(request, { mode: 'network-only' });
    expect((await first.readView(PostView, ref)).data?.likes).toBe(7);
    await first.persistence!.flush();
    const [entry] = first.persistence!.getSnapshot().mutations;
    first.persistence!.dispose();
    await disposed;

    current = makeOffline();
    await current.persistence!.ready;
    const currentRef = current.ref('Post', id, PostView);
    expect((await current.readView(PostView, currentRef)).data?.likes).toBe(7);

    // Another client can deliver the same journaled operation while this one is offline.
    server = snapshot(7, 3, [entry.id]);
    await current.request(request, { mode: 'network-only' });
    expect((await current.readView(PostView, currentRef)).data?.likes).toBe(7);
    await current.persistence!.flush();
    current.persistence!.dispose();

    current = makeOffline();
    await current.persistence!.ready;
    const restoredRef = current.ref('Post', id, PostView);
    expect((await current.readView(PostView, restoredRef)).data?.likes).toBe(7);
    expect(mutateDurably).not.toHaveBeenCalled();

    online = true;
    current.persistence!.retry();
    await vi.waitFor(() => expect(current.persistence!.getSnapshot().mutations).toHaveLength(0));
    expect(mutateDurably).toHaveBeenCalledExactlyOnceWith(
      'edit',
      { by: 2, id },
      new Set(['id', 'likes']),
      { id: entry.id, scope: 'optimistic-updater' },
    );
    expect((await current.readView(PostView, restoredRef)).data?.likes).toBe(7);
  } finally {
    current.persistence!.dispose();
  }
});

test('inline callbacks require a non-durable call when durable delivery is enabled', async () => {
  const mutate = vi.fn(async () => record(6));
  const mutateDurably = vi.fn(async () => record(6));
  const client = makeClient(
    { fetchById: async () => [record(4)], mutate, mutateDurably },
    createPersistence({ key: 'optimistic-updater', online: () => false, storage: memoryStorage() }),
  );
  try {
    const options = {
      input: { by: 2, id },
      optimistic: () => ({ likes: 6 }),
    };
    await expect(client.mutations.edit(options)).rejects.toThrow(/require persist: false/);
    await expect(client.mutations.edit({ input: { by: 2, id }, optimistic: true })).rejects.toThrow(
      /requires a view or select/,
    );
    expect(client.persistence!.getSnapshot().mutations).toHaveLength(0);
    await expect(client.mutations.edit({ ...options, persist: false })).resolves.toMatchObject({
      result: { likes: 6 },
    });
    expect(mutate).toHaveBeenCalledOnce();
    expect(mutateDurably).not.toHaveBeenCalled();
  } finally {
    client.persistence!.dispose();
  }
});

test('native HTTP carries a mutation ID through live updates, refetches, and a delayed receipt', async () => {
  let post = snapshot(4, 1);
  const submitted = Promise.withResolvers<string>();
  const respond = Promise.withResolvers<void>();
  const registered = Promise.withResolvers<void>();
  const live = createLiveEventBus();
  const serverView = dataView<Post>('Post')({ id: true, likes: true, pinned: true });
  const source: SourceDefinition<Post> = { id: 'id', view: serverView };
  const server = createFateServer({
    live,
    mutations: {
      edit: {
        async resolve({ mutationId }: { mutationId?: string }) {
          const result = (post = snapshot(5, 2, [mutationId!]));
          submitted.resolve(mutationId!);
          await respond.promise;
          return result;
        },
        type: 'Post',
      },
    },
    roots: { posts: list(serverView) },
    sources: {
      getSource: () => source as never,
      registry: createSourceRegistry([[source, { byIds: async () => [post] }]]),
    },
  });
  class TestEventSource extends EventTarget {
    private readonly controller = new AbortController();

    constructor(url: string) {
      super();
      void this.stream(url);
    }

    close() {
      this.controller.abort();
    }

    private async stream(url: string) {
      const response = await server.handleLiveRequest(
        new Request(url, { signal: this.controller.signal }),
      );
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      this.dispatchEvent(new Event('open'));
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            return;
          }
          const lines = decoder.decode(value).split('\n');
          const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
          const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
          if (event && data) {
            this.dispatchEvent(new MessageEvent(event, { data }));
          }
        }
      } finally {
        reader.releaseLock();
      }
    }
  }
  const transport = createHTTPTransport<{
    mutations: { edit: { input: Input; output: Post } };
  }>({
    eventSource: TestEventSource,
    async fetch(url, init) {
      const request = new Request(url, init);
      if (request.url.endsWith('/live')) {
        const response = await server.handleLiveRequest(request);
        registered.resolve();
        return response;
      }
      return server.handleRequest(request);
    },
    url: 'http://fate.test/',
  });
  const client = makeClient(transport);
  await client.request(request);
  const ref = client.ref('Post', id, PostView);
  const unsubscribe = client.subscribeLiveView(PostView, ref);
  await registered.promise;
  const pending = client.mutations.edit({ input: { by: 1, id }, optimistic: true });
  try {
    const mutationId = await submitted.promise;
    expect(mutationId).toEqual(expect.any(String));
    live.update('Post', id, { changed: ['likes'] });
    await vi.waitFor(() => expect(client.store.confirmedRecord('Post:1')?.likes).toBe(5));
    expect((await client.readView(PostView, ref)).data?.likes).toBe(5);

    post = snapshot(6, 3, [mutationId]);
    await client.request(request, { mode: 'network-only' });
    expect((await client.readView(PostView, ref)).data?.likes).toBe(6);
    respond.resolve();
    await expect(pending).resolves.toEqual({ error: undefined, result: record(5) });
    expect((await client.readView(PostView, ref)).data?.likes).toBe(6);

    live.delete('Post', id, { revision: 5 });
    await vi.waitFor(() => expect(client.store.deletionRevision('Post:1')).toBe(5));
    post = snapshot(7, 4, [mutationId]);
    await client.request(request, { mode: 'network-only' });
    expect(client.store.read('Post:1')).toBeUndefined();
  } finally {
    respond.resolve();
    unsubscribe();
    await pending.catch(() => undefined);
  }
});
