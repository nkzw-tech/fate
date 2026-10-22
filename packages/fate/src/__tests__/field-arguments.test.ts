import { expect, test, vi } from 'vite-plus/test';
import { hashArgs } from '../args.ts';
import { createClient } from '../client.ts';
import { defer } from '../defer.ts';
import {
  decodeHydrationValue,
  encodeHydrationValue,
  type ClientHydrationState,
} from '../hydration.ts';
import { mutation } from '../mutation.ts';
import { PersistenceCache } from '../persistence-cache.ts';
import { createPersistence } from '../persistence.ts';
import { createRequestDescriptor } from '../request-descriptor.ts';
import { clientRoot } from '../root.ts';
import { getSelectionPlan } from '../selection.ts';
import { getListKey } from '../store.ts';
import type { Transport } from '../transport.ts';
import type { SelectionOf } from '../types.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

type MapData = { __typename: 'Map'; id: string; state: string };

const PublicMap = view<MapData>()({ id: true, state: true });
const EditorMap = view<MapData>()({ id: true, state: { args: { editor: true } } });

test('caches argument-sensitive fields independently on the same entity', async () => {
  const fetchById = vi.fn<Transport['fetchById']>(async (_type, ids, _select, args) =>
    ids.map((id) => ({
      id,
      state: (args?.state as { editor?: boolean })?.editor ? 'editor' : 'public',
    })),
  );
  const client = createClient({
    roots: { map: clientRoot<MapData, 'Map'>('Map') },
    transport: { fetchById },
    types: [{ type: 'Map' }],
  });

  const editorRequest = { map: { id: '1', view: EditorMap } };
  const publicRequest = { map: { id: '1', view: PublicMap } };
  const editor = await client.request(editorRequest);
  const publicMap = await client.request(publicRequest);

  expect(fetchById).toHaveBeenCalledTimes(2);
  expect(
    (
      await client.readView<MapData, SelectionOf<typeof EditorMap>, typeof EditorMap>(
        EditorMap,
        editor.map,
      )
    ).data.state,
  ).toBe('editor');
  expect(
    (
      await client.readView<MapData, SelectionOf<typeof PublicMap>, typeof PublicMap>(
        PublicMap,
        publicMap.map,
      )
    ).data.state,
  ).toBe('public');

  await client.request(editorRequest, { mode: 'network-only' });
  expect(
    (
      await client.readView<MapData, SelectionOf<typeof PublicMap>, typeof PublicMap>(
        PublicMap,
        publicMap.map,
      )
    ).data.state,
  ).toBe('public');
  await client.request(editorRequest);
  await client.request(publicRequest);
  expect(fetchById).toHaveBeenCalledTimes(3);
});

test('does not share concurrent missing-field fetches across argument values', async () => {
  const fetchById = vi.fn<Transport['fetchById']>(async (_type, ids, select, args) => {
    expect([...select]).toEqual(['state']);
    return ids.map((id) => ({ id, state: JSON.stringify(args?.state) }));
  });
  const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'Map' }] });
  client.write('Map', { id: '1' }, new Set(['id']));
  const ViewerMap = view<MapData>()({ id: true, state: { args: { spectatorCodes: ['a.b'] } } });
  const [editor, spectator] = await Promise.all([
    client.readView<MapData, SelectionOf<typeof EditorMap>, typeof EditorMap>(
      EditorMap,
      client.ref('Map', '1', EditorMap),
    ),
    client.readView<MapData, SelectionOf<typeof ViewerMap>, typeof ViewerMap>(
      ViewerMap,
      client.ref('Map', '1', ViewerMap),
    ),
  ]);

  expect(fetchById).toHaveBeenCalledTimes(2);
  expect(editor.data.state).toBe('{"editor":true}');
  expect(spectator.data.state).toBe('{"spectatorCodes":["a.b"]}');
});

test('canonicalizes field argument order without confusing punctuation with selection paths', async () => {
  const First = view<MapData>()({ state: { args: { locale: 'en.US', version: 1.5 } } });
  const Second = view<MapData>()({ state: { args: { locale: 'en.US', version: 1.5 } } });
  const Different = view<MapData>()({ state: { args: { locale: 'en', version: 1.5 } } });
  const fetchById = vi.fn<Transport['fetchById']>(async () => [{ id: '1', state: 'different' }]);
  const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'Map' }] });
  const plan = getSelectionPlan(First, null);
  client.write('Map', { id: '1', state: 'same' }, plan.paths, plan);

  expect(
    (
      await client.readView<MapData, SelectionOf<typeof Second>, typeof Second>(
        Second,
        client.ref('Map', '1', Second),
      )
    ).data.state,
  ).toBe('same');
  expect(fetchById).not.toHaveBeenCalled();
  expect(
    (
      await client.readView<MapData, SelectionOf<typeof Different>, typeof Different>(
        Different,
        client.ref('Map', '1', Different),
      )
    ).data.state,
  ).toBe('different');
  expect(
    (
      await client.readView<MapData, SelectionOf<typeof First>, typeof First>(
        First,
        client.ref('Map', '1', First),
      )
    ).data.state,
  ).toBe('same');
});

test('keeps argument-sensitive fields and links isolated inside normalized relations', async () => {
  type Game = { __typename: 'Game'; id: string; map: MapData | null };
  const EditorGame = view<Game>()({
    map: { args: { revision: 'draft' }, id: true, state: { args: { editor: true } } },
  });
  const PublicGame = view<Game>()({ map: { id: true, state: true } });
  const client = createClient({
    roots: { game: clientRoot<Game, 'Game'>('Game') },
    transport: {
      fetchById: vi.fn(),
      fetchQuery: async (_name, _select, args) => ({
        id: '1',
        map: { id: '1', state: args?.map ? 'editor' : 'public' },
      }),
    },
    types: [
      { fields: { map: { type: 'Map' } }, type: 'Game' },
      { fields: { state: 'scalar' }, type: 'Map' },
    ],
  });
  const editor = await client.request({ game: { view: EditorGame } });
  const publicGame = await client.request({ game: { view: PublicGame } });
  expect(
    (
      await client.readView<Game, SelectionOf<typeof EditorGame>, typeof EditorGame>(
        EditorGame,
        editor.game!,
      )
    ).data.map?.state,
  ).toBe('editor');
  expect(
    (
      await client.readView<Game, SelectionOf<typeof PublicGame>, typeof PublicGame>(
        PublicGame,
        publicGame.game!,
      )
    ).data.map?.state,
  ).toBe('public');

  const plan = getSelectionPlan(PublicGame, null);
  client.write('Game', { id: '1', map: null }, plan.paths, plan);
  expect(
    (
      await client.readView<Game, SelectionOf<typeof PublicGame>, typeof PublicGame>(
        PublicGame,
        publicGame.game!,
      )
    ).data.map,
  ).toBeNull();
  expect(
    (
      await client.readView<Game, SelectionOf<typeof EditorGame>, typeof EditorGame>(
        EditorGame,
        editor.game!,
      )
    ).data.map?.state,
  ).toBe('editor');
});

test('scopes live updates and subscriber notifications to the selected field arguments', async () => {
  let handlers: Parameters<NonNullable<Transport['subscribeById']>>[4] | undefined;
  const client = createClient({
    roots: {},
    transport: {
      fetchById: vi.fn(),
      subscribeById: (_type, _id, _select, _args, nextHandlers) => {
        handlers = nextHandlers;
        return () => {};
      },
    },
    types: [{ type: 'Map' }],
  });
  const editorPlan = getSelectionPlan(EditorMap, null);
  const publicPlan = getSelectionPlan(PublicMap, null);
  client.write('Map', { id: '1', state: 'editor' }, editorPlan.paths, editorPlan);
  client.write('Map', { id: '1', state: 'public' }, publicPlan.paths, publicPlan);
  const editorRef = client.ref('Map', '1', EditorMap);
  const publicRef = client.ref('Map', '1', PublicMap);
  const editor = await client.readView<MapData, SelectionOf<typeof EditorMap>, typeof EditorMap>(
    EditorMap,
    editorRef,
  );
  const publicMap = await client.readView<MapData, SelectionOf<typeof PublicMap>, typeof PublicMap>(
    PublicMap,
    publicRef,
  );
  const editorChanged = vi.fn();
  const publicChanged = vi.fn();
  const unsubscribeEditor = client.store.subscribe('Map:1', editor.coverage[0][1], editorChanged);
  const unsubscribePublic = client.store.subscribe(
    'Map:1',
    publicMap.coverage[0][1],
    publicChanged,
  );
  const dispose = client.subscribeLiveView(EditorMap, editorRef);
  handlers!.onData({ id: '1', state: 'updated editor' });
  expect(editorChanged).toHaveBeenCalledTimes(1);
  expect(publicChanged).not.toHaveBeenCalled();
  expect(
    (
      await client.readView<MapData, SelectionOf<typeof EditorMap>, typeof EditorMap>(
        EditorMap,
        editorRef,
      )
    ).data.state,
  ).toBe('updated editor');
  expect(
    (
      await client.readView<MapData, SelectionOf<typeof PublicMap>, typeof PublicMap>(
        PublicMap,
        publicRef,
      )
    ).data.state,
  ).toBe('public');
  dispose();
  unsubscribeEditor();
  unsubscribePublic();
});

test('rolls back an optimistic field variant without undoing another variant update', async () => {
  const pending = Promise.withResolvers<MapData>();
  const mutations = { edit: mutation<MapData, { id: string }, MapData>('Map') };
  const roots = {};
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport: {
      fetchById: vi.fn(),
      // @ts-expect-error The mock returns a concrete MapData; the transport method is generic.
      mutate: () => pending.promise,
    },
    types: [{ type: 'Map' }],
  });
  const editorPlan = getSelectionPlan(EditorMap, null);
  const publicPlan = getSelectionPlan(PublicMap, null);
  client.write('Map', { id: '1', state: 'editor' }, editorPlan.paths, editorPlan);
  client.write('Map', { id: '1', state: 'public' }, publicPlan.paths, publicPlan);
  const result = client.mutations.edit({
    input: { id: '1' },
    optimistic: { state: 'optimistic editor' },
    view: EditorMap,
  });
  expect(
    (
      await client.readView<MapData, SelectionOf<typeof EditorMap>, typeof EditorMap>(
        EditorMap,
        client.ref('Map', '1', EditorMap),
      )
    ).data.state,
  ).toBe('optimistic editor');
  client.write('Map', { id: '1', state: 'updated public' }, publicPlan.paths, publicPlan);
  pending.reject(new Error('Rejected'));
  await expect(result).rejects.toThrow('Rejected');
  expect(
    (
      await client.readView<MapData, SelectionOf<typeof EditorMap>, typeof EditorMap>(
        EditorMap,
        client.ref('Map', '1', EditorMap),
      )
    ).data.state,
  ).toBe('editor');
  expect(
    (
      await client.readView<MapData, SelectionOf<typeof PublicMap>, typeof PublicMap>(
        PublicMap,
        client.ref('Map', '1', PublicMap),
      )
    ).data.state,
  ).toBe('updated public');
});

test('fetches deferred scalar arguments independently of eager scalar coverage', async () => {
  const DeferredMap = view<MapData>()({ id: true, state: defer({ args: { editor: true } }) });
  const fetchById = vi.fn<Transport['fetchById']>(async () => [{ id: '1', state: 'editor' }]);
  const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'Map' }] });
  client.write('Map', { id: '1', state: 'public' }, new Set(['id', 'state']));
  const snapshot = await client.readView<
    MapData,
    SelectionOf<typeof DeferredMap>,
    typeof DeferredMap
  >(DeferredMap, client.ref('Map', '1', DeferredMap));
  expect((await client.readDeferred(snapshot.data.state)).data).toBe('editor');
  expect(
    (
      await client.readView<MapData, SelectionOf<typeof PublicMap>, typeof PublicMap>(
        PublicMap,
        client.ref('Map', '1', PublicMap),
      )
    ).data.state,
  ).toBe('public');
});

test('preserves field variants and coverage through hydration and garbage collection', async () => {
  const roots = { map: clientRoot<MapData, 'Map'>('Map') };
  const types = [{ type: 'Map' }];
  const fetchById = vi.fn<Transport['fetchById']>(async () => {
    throw new Error('Unexpected fetch');
  });
  const client = createClient({ roots, transport: { fetchById }, types });
  const editorPlan = getSelectionPlan(EditorMap, null);
  client.write('Map', { id: '1', state: 'editor' }, editorPlan.paths, editorPlan);
  client.write('Map', { id: '1', state: 'public' }, new Set(['id', 'state']));
  const hydrated = createClient({ gcReleaseBufferSize: 0, roots, transport: { fetchById }, types });
  hydrated.hydrate(structuredClone(client.dehydrate()));
  const request = { map: { id: '1', view: EditorMap } };
  const retained = hydrated.retain(request);
  await hydrated.request(request);
  hydrated.gc();
  expect(
    (
      await hydrated.readView<MapData, SelectionOf<typeof EditorMap>, typeof EditorMap>(
        EditorMap,
        hydrated.ref('Map', '1', EditorMap),
      )
    ).data.state,
  ).toBe('editor');
  expect(
    (
      await hydrated.readView<MapData, SelectionOf<typeof PublicMap>, typeof PublicMap>(
        PublicMap,
        hydrated.ref('Map', '1', PublicMap),
      )
    ).data.state,
  ).toBe('public');
  expect(fetchById).not.toHaveBeenCalled();
  retained.dispose();
  hydrated.gc();
  expect(hydrated.store.read('Map:1')).toBeUndefined();
});

test('restores only the requested field variant from persistence', async () => {
  const storage = memoryStorage();
  const fetchById = vi.fn<Transport['fetchById']>(async (_type, ids, _select, args) =>
    ids.map((id) => ({ id, state: args?.state ? 'editor' : 'public' })),
  );
  const setup = () =>
    createClient({
      persistence: createPersistence({ key: 'field-args', online: () => false, storage }),
      roots: { map: clientRoot<MapData, 'Map'>('Map') },
      transport: { fetchById },
      types: [{ type: 'Map' }],
    });
  const first = setup();
  try {
    await first.request({ map: { id: '1', view: EditorMap } });
    await first.request({ map: { id: '1', view: PublicMap } });
    await first.persistence!.flush();
  } finally {
    first.persistence!.dispose();
  }
  fetchById.mockClear();
  fetchById.mockRejectedValue(new Error('Offline'));
  const restored = setup();
  try {
    const editor = await restored.request({ map: { id: '1', view: EditorMap } });
    expect(
      (
        await restored.readView<MapData, SelectionOf<typeof EditorMap>, typeof EditorMap>(
          EditorMap,
          editor.map,
        )
      ).data.state,
    ).toBe('editor');
    expect(restored.store.read('Map:1')?.state).toBeUndefined();
    const publicMap = await restored.request({ map: { id: '1', view: PublicMap } });
    expect(
      (
        await restored.readView<MapData, SelectionOf<typeof PublicMap>, typeof PublicMap>(
          PublicMap,
          publicMap.map,
        )
      ).data.state,
    ).toBe('public');
    expect(
      (
        await restored.readView<MapData, SelectionOf<typeof EditorMap>, typeof EditorMap>(
          EditorMap,
          editor.map,
        )
      ).data.state,
    ).toBe('editor');
    expect(fetchById).not.toHaveBeenCalled();
  } finally {
    restored.persistence!.dispose();
  }
});

test('keys node request handles by arguments when a view factory is reused', async () => {
  const mapView = view<MapData>();
  const editor = mapView({ state: { args: { editor: true } } });
  const publicMap = mapView({ state: { args: { editor: false } } });
  const fetchById = vi.fn<Transport['fetchById']>(async (_type, ids, _select, args) =>
    ids.map((id) => ({
      id,
      state: (args?.state as { editor?: boolean } | undefined)?.editor ? 'editor' : 'public',
    })),
  );
  const client = createClient({
    roots: { map: clientRoot<MapData, 'Map'>('Map') },
    transport: { fetchById },
    types: [{ type: 'Map' }],
  });
  await client.request({ map: { id: '1', view: editor } });
  await client.request({ map: { id: '1', view: publicMap } });
  expect(fetchById).toHaveBeenCalledTimes(2);
  await client.request({ map: { ids: ['1', '2'], view: editor } });
  await client.request({ map: { ids: ['1', '2'], view: publicMap } });
  expect(fetchById).toHaveBeenCalledTimes(4);
  expect(fetchById.mock.calls[2][1]).toEqual(['2']);
  expect(fetchById.mock.calls[3][1]).toEqual(['2']);
});

test('normalized query identity shares child selections while keeping actual root arguments separate', async () => {
  const fetchQuery = vi.fn<NonNullable<Transport['fetchQuery']>>(async (_root, _select, args) => ({
    id: String(args?.slug),
    state: 'editor',
  }));
  const client = createClient({
    roots: { map: clientRoot<MapData, 'Map'>('Map') },
    transport: { fetchById: async () => [], fetchQuery },
    types: [{ type: 'Map' }],
  });
  await client.request({ map: { args: { slug: 'one' }, view: EditorMap } });
  const summary = { map: { args: { slug: 'one' }, view: view<MapData>()({ id: true }) } };
  expect(client.observeRequest(summary, { mode: 'cache-only' }).getSnapshot()).toMatchObject({
    data: { map: { id: 'one' } },
    status: 'ready',
  });
  expect(
    client
      .observeRequest({ map: { ...summary.map, args: { slug: 'two' } } }, { mode: 'cache-only' })
      .getSnapshot().status,
  ).toBe('missing');
  expect(fetchQuery).toHaveBeenCalledTimes(1);
});

test('legacy persisted query keys remain readable and retain their entities', async () => {
  const fetchQuery = vi.fn<NonNullable<Transport['fetchQuery']>>(async () => ({
    id: 'one',
    state: 'editor',
  }));
  const roots = { map: clientRoot<MapData, 'Map'>('Map') };
  const client = createClient({
    roots,
    transport: { fetchById: async () => [], fetchQuery },
    types: [{ type: 'Map' }],
  });
  const request = { map: { args: { slug: 'one' }, view: EditorMap } };
  await client.request(request);
  const state = client.dehydrate();
  const decoded = decodeHydrationValue(state.data) as ClientHydrationState;
  const legacyKey = getListKey(
    '__root__',
    'map',
    hashArgs({ slug: 'one', state: { editor: true } }),
  );
  const restored = createClient({
    gcReleaseBufferSize: 0,
    roots,
    transport: { fetchById: async () => [], fetchQuery },
    types: [{ type: 'Map' }],
  });
  restored.hydrate({
    ...state,
    data: encodeHydrationValue({ ...decoded, rootRequests: [[legacyKey, 'Map:one']] }),
  });
  const observer = restored.observeRequest(request, { mode: 'cache-only' });
  const dispose = observer.subscribe(() => {});
  restored.gc();
  expect(observer.getSnapshot()).toMatchObject({ data: { map: { id: 'one' } }, status: 'ready' });
  expect(restored.store.read('Map:one')).toBeDefined();
  expect(fetchQuery).toHaveBeenCalledTimes(1);
  fetchQuery.mockResolvedValueOnce(null);
  await restored.request(request, { mode: 'network-only' });
  expect(observer.getSnapshot()).toMatchObject({ data: { map: null }, status: 'ready' });
  dispose();
});

test.each([false, true])(
  'restores legacy query keys from disk while offline (null: %s)',
  async (nullable) => {
    const storage = memoryStorage();
    const roots = { map: clientRoot<MapData | null, 'Map'>('Map') };
    const fetchQuery = vi.fn<NonNullable<Transport['fetchQuery']>>(async () =>
      nullable ? null : { id: 'one', state: 'editor' },
    );
    const options = {
      roots,
      transport: { fetchById: async () => [], fetchQuery },
      types: [{ type: 'Map' }],
    };
    const first = createClient(options);
    const request = { map: { args: { slug: 'one' }, view: EditorMap } };
    await first.request(request);
    const descriptor = createRequestDescriptor(request, () => 'Map');
    const item = descriptor.items[0];
    if (item.kind !== 'query' || !item.legacyQueryKey) {
      throw new Error('Expected a query with a legacy key');
    }
    const legacy = {
      ...descriptor,
      items: [{ ...item, legacyQueryKey: undefined, queryKey: item.legacyQueryKey }],
    };
    const state = first.dehydrate();
    first.hydrate({
      ...state,
      data: encodeHydrationValue({
        ...(decodeHydrationValue(state.data) as ClientHydrationState),
        rootRequests: [[item.legacyQueryKey, nullable ? null : 'Map:one']],
      }),
    });
    const cache = new PersistenceCache(first, storage, 'legacy-query', 60_000, 1024 * 1024);
    try {
      await cache.initialize();
      cache.fetched(legacy);
      await cache.flush(0);
    } finally {
      cache.dispose();
    }
    fetchQuery.mockClear();
    fetchQuery.mockRejectedValue(new Error('Offline'));
    const restored = createClient({
      ...options,
      persistence: createPersistence({ key: 'legacy-query', online: () => false, storage }),
    });
    try {
      const result = await restored.request(request);
      expect(result.map).toEqual(nullable ? null : expect.objectContaining({ id: 'one' }));
      expect(fetchQuery).not.toHaveBeenCalled();
    } finally {
      restored.persistence!.dispose();
    }
  },
);
