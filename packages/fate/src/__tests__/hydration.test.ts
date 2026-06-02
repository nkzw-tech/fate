import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import {
  decodeHydrationValue,
  encodeHydrationValue,
  type FateDehydratedState,
} from '../hydration.ts';
import { createNodeRef, getNodeRefId } from '../node-ref.ts';
import { toEntityId } from '../ref.ts';
import { clientRoot } from '../root.ts';
import { getListKey } from '../store.ts';
import { type AnyRecord, type SelectionOf, type ViewSnapshot } from '../types.ts';
import { view } from '../view.ts';

type Post = {
  __typename: 'Post';
  comments: Array<Comment>;
  content: string;
  id: string;
  title: string;
};

type Comment = {
  __typename: 'Comment';
  id: string;
};

const unwrap = <T extends ViewSnapshot<any, any>>(value: PromiseLike<T> & { value?: T }) => {
  if (!value.value) {
    throw new Error(`Expected a fulfilled view.`);
  }
  return value.value.data;
};

const jsonRoundTrip = <T>(value: T): T => {
  // eslint-disable-next-line unicorn/prefer-structured-clone -- Verify JSON transport compatibility.
  return JSON.parse(JSON.stringify(value)) as T;
};

const types = [
  {
    fields: { comments: { listOf: 'Comment' }, content: 'scalar', title: 'scalar' },
    type: 'Post',
  },
  { type: 'Comment' },
] as const;

const createMetadataClient = () =>
  createClient({
    roots: {},
    transport: { fetchById: vi.fn() },
    types: [{ fields: { metadata: 'scalar' }, type: 'Post' }],
  });

const emptyHydrationState = () => ({
  rootLists: [],
  rootRequests: [],
  store: { coverage: [], lists: [], records: [] },
});

const hydrationState = (data: unknown, scope?: string) =>
  ({
    data: encodeHydrationValue(data),
    scope:
      scope ??
      createClient({ roots: {}, transport: { fetchById: vi.fn() }, types }).dehydrate().scope,
    version: 1,
  }) as const;

test('hydrates normalized records and field coverage without refetching', async () => {
  const PostView = view<Post>()({ content: true, id: true, title: true });
  const server = createClient({
    roots: { post: clientRoot('Post') },
    transport: { fetchById: vi.fn() },
    types,
  });

  server.write(
    'Post',
    { __typename: 'Post', content: 'Content', id: 'post-1', title: 'Title' },
    new Set(['content', 'id', 'title']),
  );

  const fetchById = vi.fn();
  const browser = createClient({
    roots: { post: clientRoot('Post') },
    transport: { fetchById },
    types,
  });
  browser.hydrate(jsonRoundTrip(server.dehydrate()));

  const request = { post: { id: 'post-1', view: PostView } };
  const { post } = await browser.request(request);
  const data = unwrap(
    browser.readView<Post, SelectionOf<typeof PostView>, typeof PostView>(PostView, post),
  );

  expect(data).toMatchObject({ content: 'Content', title: 'Title' });
  expect(fetchById).not.toHaveBeenCalled();
});

test('hydrates root queries, nullable queries, and paginated root lists', async () => {
  type User = { __typename: 'User'; id: string; name: string };

  const UserView = view<User>()({ id: true, name: true });
  const PostView = view<Post>()({ id: true, title: true });
  const PostConnectionView = {
    items: { cursor: true, node: PostView },
    pagination: { hasNext: true, nextCursor: true },
  } as const;
  const roots = {
    posts: clientRoot('Post'),
    session: clientRoot<User | null, 'User'>('User'),
    viewer: clientRoot<User, 'User'>('User'),
  };
  const server = createClient({
    roots,
    transport: {
      fetchById: vi.fn(),
      fetchList: vi.fn().mockResolvedValue({
        items: [{ cursor: 'cursor-1', node: { __typename: 'Post', id: 'post-1', title: 'One' } }],
        pagination: { hasNext: false, hasPrevious: false },
      }),
      fetchQuery: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ __typename: 'User', id: 'user-1', name: 'Kiwi' }),
    },
    types: [...types, { fields: { name: 'scalar' }, type: 'User' }],
  });
  const request = {
    posts: { args: { first: 1 }, list: PostConnectionView },
    session: { view: UserView },
    viewer: { view: UserView },
  };

  await server.request(request);

  const fetchList = vi.fn();
  const fetchQuery = vi.fn();
  const browser = createClient({
    roots,
    transport: { fetchById: vi.fn(), fetchList, fetchQuery },
    types: [...types, { fields: { name: 'scalar' }, type: 'User' }],
  });
  browser.hydrate(jsonRoundTrip(server.dehydrate()));

  const result = (await browser.request(request)) as unknown as {
    posts: {
      items: ReadonlyArray<{ node: { id: string } }>;
      pagination?: { hasNext: boolean };
    };
    session: null;
    viewer: { id: string };
  };

  expect(result.posts.items.map(({ node }) => node.id)).toEqual(['post-1']);
  expect(result.posts.pagination?.hasNext).toBe(false);
  expect(result.session).toBeNull();
  expect(result.viewer.id).toBe('user-1');
  expect(fetchList).not.toHaveBeenCalled();
  expect(fetchQuery).not.toHaveBeenCalled();
});

test('preserves existing browser fields by default and supports authoritative replacement', () => {
  const PostView = view<Post>()({ content: true, id: true, title: true });
  const create = () =>
    createClient({
      roots: {},
      transport: { fetchById: vi.fn() },
      types,
    });
  const server = create();
  server.write(
    'Post',
    { __typename: 'Post', content: 'Server content', id: 'post-1', title: 'Server title' },
    new Set(['content', 'id', 'title']),
  );
  const state = server.dehydrate();

  const browser = create();
  browser.write(
    'Post',
    { __typename: 'Post', id: 'post-1', title: 'Browser title' },
    new Set(['id', 'title']),
  );
  browser.hydrate(state);

  const ref = browser.ref('Post', 'post-1', PostView);
  expect(unwrap(browser.readView(PostView, ref))).toMatchObject({
    content: 'Server content',
    title: 'Browser title',
  });

  browser.hydrate(state, { merge: 'replace' });
  expect(unwrap(browser.readView(PostView, ref))).toMatchObject({
    content: 'Server content',
    title: 'Server title',
  });
});

test('preserves nested browser scalar fields while merging hydrated fields', () => {
  const server = createMetadataClient();
  server.write(
    'Post',
    {
      __typename: 'Post',
      id: 'post-1',
      metadata: { author: 'Server', published: true, updatedAt: new Date('2026-06-01T00:00:00Z') },
    },
    new Set(['id', 'metadata.author', 'metadata.published']),
  );

  const browser = createMetadataClient();
  const browserDate = new Date('2026-06-02T00:00:00Z');
  browser.write(
    'Post',
    { __typename: 'Post', id: 'post-1', metadata: { author: 'Browser', updatedAt: browserDate } },
    new Set(['id', 'metadata.author']),
  );
  browser.hydrate(server.dehydrate());

  expect(browser.store.read(toEntityId('Post', 'post-1'))?.metadata).toEqual({
    author: 'Browser',
    published: true,
    updatedAt: browserDate,
  });
});

test('preserves prototype-named fields without changing merged record prototypes', () => {
  const server = createMetadataClient();
  const browser = createMetadataClient();
  const metadata: AnyRecord = { server: true };
  Object.defineProperty(metadata, '__proto__', { enumerable: true, value: 'browser' });

  server.write(
    'Post',
    { __typename: 'Post', id: 'post-1', metadata: { hydrated: true } },
    new Set(['id', 'metadata.hydrated']),
  );
  browser.write(
    'Post',
    { __typename: 'Post', id: 'post-1', metadata },
    new Set(['id', 'metadata.server']),
  );
  browser.hydrate(server.dehydrate());

  const merged = browser.store.read(toEntityId('Post', 'post-1'))?.metadata as AnyRecord;
  expect(merged).toMatchObject({ hydrated: true, server: true });
  expect(merged.__proto__).toBe('browser');
  expect(Object.getPrototypeOf(merged)).toBeNull();
});

test('rebuilds relation and list indexes while hydrating', () => {
  const server = createClient({
    roots: {},
    transport: { fetchById: vi.fn() },
    types,
  });
  server.write(
    'Post',
    {
      __typename: 'Post',
      comments: [{ __typename: 'Comment', id: 'comment-1' }],
      id: 'post-1',
    },
    new Set(['comments.id', 'id']),
  );

  const browser = createClient({
    roots: {},
    transport: { fetchById: vi.fn() },
    types,
  });
  browser.hydrate(server.dehydrate());
  browser.deleteRecord('Comment', 'comment-1');

  const postId = toEntityId('Post', 'post-1');
  expect(browser.store.getListState(getListKey(postId, 'comments'))?.ids).toEqual([]);
  expect(browser.store.read(postId)?.comments).toEqual([]);
});

test('hydrates list windows and root-list registrations used by mutation insertion', async () => {
  const PostView = view<Post>()({ id: true, title: true });
  const PostConnectionView = {
    items: { cursor: true, node: PostView },
    pagination: { hasNext: true, hasPrevious: true, nextCursor: true, previousCursor: true },
  } as const;
  const roots = { posts: clientRoot('Post') };
  const server = createClient({
    roots,
    transport: {
      fetchById: vi.fn(),
      fetchList: vi.fn().mockResolvedValue({
        items: [{ cursor: 'cursor-1', node: { __typename: 'Post', id: 'post-1', title: 'One' } }],
        pagination: {
          hasNext: true,
          hasPrevious: true,
          nextCursor: 'cursor-next',
          previousCursor: 'cursor-previous',
        },
      }),
    },
    types,
  });

  await server.request({ posts: { args: { first: 1 }, list: PostConnectionView } });
  const [[listKey]] = server.store.dehydrate().lists;
  server.store.setList(listKey, {
    backwardPageLimit: 1,
    cursors: ['cursor-1'],
    forwardPageLimit: 1,
    ids: [toEntityId('Post', 'post-1')],
    liveAfterIds: [toEntityId('Post', 'post-live-after')],
    liveBeforeIds: [toEntityId('Post', 'post-live-before')],
    pagination: {
      hasNext: true,
      hasPrevious: true,
      nextCursor: 'cursor-next',
      previousCursor: 'cursor-previous',
    },
    pendingAfterIds: [toEntityId('Post', 'post-pending-after')],
    pendingBeforeIds: [toEntityId('Post', 'post-pending-before')],
  });

  const browser = createClient({ roots, transport: { fetchById: vi.fn() }, types });
  browser.hydrate(jsonRoundTrip(server.dehydrate()));

  expect(browser.store.getListState(listKey)).toEqual(server.store.getListState(listKey));

  browser.write(
    'Post',
    { __typename: 'Post', id: 'post-2', title: 'Two' },
    new Set(['id', 'title']),
    undefined,
    undefined,
    null,
    undefined,
    'after',
  );
  expect(browser.store.getListState(listKey)?.pendingAfterIds).toContain(
    toEntityId('Post', 'post-2'),
  );
});

test('replaying replacement hydration is idempotent and only notifies durable changes', () => {
  const create = () => createClient({ roots: {}, transport: { fetchById: vi.fn() }, types });
  const server = create();
  const browser = create();
  const postId = toEntityId('Post', 'post-1');
  const listKey = getListKey(postId, 'comments');
  const recordSubscriber = vi.fn();
  const listSubscriber = vi.fn();
  browser.store.subscribe(postId, recordSubscriber);
  browser.store.subscribeList(listKey, listSubscriber);

  server.write(
    'Post',
    { __typename: 'Post', comments: [], id: 'post-1', title: 'One' },
    new Set(['comments.id', 'id', 'title']),
  );
  const first = jsonRoundTrip(server.dehydrate());
  browser.hydrate(first, { merge: 'replace' });
  browser.hydrate(first, { merge: 'replace' });

  expect(recordSubscriber).toHaveBeenCalledTimes(1);
  expect(listSubscriber).toHaveBeenCalledTimes(1);

  server.write(
    'Post',
    { __typename: 'Post', id: 'post-1', title: 'Two' },
    new Set(['id', 'title']),
  );
  browser.hydrate(jsonRoundTrip(server.dehydrate()), { merge: 'replace' });

  expect(recordSubscriber).toHaveBeenCalledTimes(2);
  expect(listSubscriber).toHaveBeenCalledTimes(1);
});

test('replacement hydration removes durable browser state missing from the snapshot', () => {
  const browser = createClient({ roots: {}, transport: { fetchById: vi.fn() }, types });
  const postId = toEntityId('Post', 'post-1');
  const listKey = getListKey(postId, 'comments');
  browser.write(
    'Post',
    { __typename: 'Post', comments: [], id: 'post-1', title: 'One' },
    new Set(['comments.id', 'id', 'title']),
  );

  browser.hydrate(hydrationState(emptyHydrationState()), { merge: 'replace' });

  expect(browser.store.read(postId)).toBeUndefined();
  expect(browser.store.getListState(listKey)).toBeUndefined();
  expect(browser.store.missingForSelection(postId, new Set(['title']))).toEqual(new Set(['title']));
});

test('preserves existing browser list windows and notifies when coverage expands', () => {
  const server = createClient({ roots: {}, transport: { fetchById: vi.fn() }, types });
  const browser = createClient({ roots: {}, transport: { fetchById: vi.fn() }, types });
  const postId = toEntityId('Post', 'post-1');
  const listKey = getListKey(postId, 'comments');
  const recordSubscriber = vi.fn();

  server.write(
    'Post',
    { __typename: 'Post', content: 'Same', id: 'post-1' },
    new Set(['content', 'id']),
  );
  server.store.setList(listKey, { ids: [toEntityId('Comment', 'server')] });

  browser.write('Post', { __typename: 'Post', content: 'Same', id: 'post-1' }, new Set(['id']));
  browser.store.setList(listKey, { ids: [toEntityId('Comment', 'browser')] });
  browser.store.subscribe(postId, recordSubscriber);

  browser.hydrate(server.dehydrate());

  expect(browser.store.getListState(listKey)?.ids).toEqual([toEntityId('Comment', 'browser')]);
  expect(browser.store.missingForSelection(postId, new Set(['content']))).toEqual(new Set());
  expect(recordSubscriber).toHaveBeenCalledTimes(1);
});

test('preserves browser root query results by default and replaces them explicitly', async () => {
  type User = { __typename: 'User'; id: string; name: string };

  const UserView = view<User>()({ id: true, name: true });
  const roots = { viewer: clientRoot<User, 'User'>('User') };
  const types = [{ fields: { name: 'scalar' }, type: 'User' }] as const;
  const request = { viewer: { view: UserView } };
  const server = createClient({
    roots,
    transport: {
      fetchById: vi.fn(),
      fetchQuery: vi.fn().mockResolvedValue({ __typename: 'User', id: 'server', name: 'Server' }),
    },
    types,
  });
  const browser = createClient({
    roots,
    transport: {
      fetchById: vi.fn(),
      fetchQuery: vi.fn().mockResolvedValue({ __typename: 'User', id: 'browser', name: 'Browser' }),
    },
    types,
  });
  await server.request(request);
  await browser.request(request);

  browser.hydrate(server.dehydrate());
  expect(
    ((await browser.request(request)) as unknown as { viewer: { id: string } }).viewer.id,
  ).toBe('browser');

  browser.hydrate(server.dehydrate(), { merge: 'replace' });
  expect(
    ((await browser.request(request)) as unknown as { viewer: { id: string } }).viewer.id,
  ).toBe('server');
});

test('notifies subscribers after replacement root queries are fully hydrated', async () => {
  type User = { __typename: 'User'; id: string; name: string };

  const UserView = view<User>()({ id: true, name: true });
  const roots = { viewer: clientRoot<User, 'User'>('User') };
  const types = [{ fields: { name: 'scalar' }, type: 'User' }] as const;
  const request = { viewer: { view: UserView } };
  const server = createClient({
    roots,
    transport: {
      fetchById: vi.fn(),
      fetchQuery: vi.fn().mockResolvedValue({ __typename: 'User', id: 'server', name: 'Server' }),
    },
    types,
  });
  const browser = createClient({
    roots,
    transport: {
      fetchById: vi.fn(),
      fetchQuery: vi.fn().mockResolvedValue({ __typename: 'User', id: 'browser', name: 'Browser' }),
    },
    types,
  });
  await server.request(request);
  await browser.request(request);

  const subscriber = vi.fn(() => {
    expect((browser.getRequestResult(request).viewer as { id: string }).id).toBe('server');
  });
  browser.store.subscribe(toEntityId('User', 'browser'), subscriber);
  browser.hydrate(server.dehydrate(), { merge: 'replace' });

  expect(subscriber).toHaveBeenCalledTimes(1);
});

test('notifies list subscribers after replacement root-list registrations are fully hydrated', async () => {
  const PostView = view<Post>()({ id: true, title: true });
  const PostConnectionView = { items: { node: PostView } } as const;
  const roots = { posts: clientRoot('Post') };
  const server = createClient({
    roots,
    transport: {
      fetchById: vi.fn(),
      fetchList: vi.fn().mockResolvedValue({
        items: [{ node: { __typename: 'Post', id: 'post-1', title: 'One' } }],
        pagination: { hasNext: false, hasPrevious: false },
      }),
    },
    types,
  });
  await server.request({ posts: { list: PostConnectionView } });
  const [[listKey]] = server.store.dehydrate().lists;

  const browser = createClient({ roots, transport: { fetchById: vi.fn() }, types });
  let inserted = false;
  browser.store.subscribeList(listKey, () => {
    if (inserted) {
      return;
    }
    inserted = true;
    browser.write(
      'Post',
      { __typename: 'Post', id: 'post-2', title: 'Two' },
      new Set(['id', 'title']),
      undefined,
      undefined,
      null,
      undefined,
      'after',
    );
  });

  browser.hydrate(server.dehydrate(), { merge: 'replace' });

  expect(browser.store.getListState(listKey)?.ids).toContain(toEntityId('Post', 'post-2'));
});

test('round-trips supported scalar values and internal references', () => {
  const value: AnyRecord = {
    bigint: BigInt(10),
    date: new Date('2026-06-02T12:00:00.000Z'),
    infinity: Infinity,
    nan: Number.NaN,
    negativeInfinity: -Infinity,
    negativeZero: -0,
    ref: createNodeRef('Post:post-1'),
    undefined,
  };
  Object.defineProperty(value, '__proto__', {
    enumerable: true,
    value: 'prototype-key',
  });

  const decoded = decodeHydrationValue(jsonRoundTrip(encodeHydrationValue(value))) as AnyRecord;

  expect(decoded.bigint).toBe(BigInt(10));
  expect(decoded.date).toEqual(value.date);
  expect(decoded.infinity).toBe(Infinity);
  expect(decoded.nan).toBeNaN();
  expect(decoded.negativeInfinity).toBe(-Infinity);
  expect(Object.is(decoded.negativeZero, -0)).toBe(true);
  expect(getNodeRefId(decoded.ref as ReturnType<typeof createNodeRef>)).toBe('Post:post-1');
  expect('undefined' in decoded).toBe(true);
  expect(decoded.undefined).toBeUndefined();
  expect(decoded.__proto__).toBe('prototype-key');
  expect(Object.getPrototypeOf(decoded)).toBeNull();
});

test('derives stable direct-client scopes without locale-sensitive ordering', () => {
  const first = createClient({
    roots: { '\u00e4': clientRoot('\u00e4'), z: clientRoot('z') },
    transport: { fetchById: vi.fn() },
    types: [{ fields: { '\u00e4': 'scalar', z: 'scalar' }, type: '\u00e4' }, { type: 'z' }],
  });
  const second = createClient({
    roots: { '\u00e4': clientRoot('\u00e4'), z: clientRoot('z') },
    transport: { fetchById: vi.fn() },
    types: [{ type: 'z' }, { fields: { '\u00e4': 'scalar', z: 'scalar' }, type: '\u00e4' }],
  });

  expect(first.dehydrate().scope).toBe(second.dehydrate().scope);
  expect(JSON.parse(first.dehydrate().scope)).toEqual({
    roots: [
      ['z', 'z'],
      ['\u00e4', '\u00e4'],
    ],
    types: [
      { fields: [], type: 'z' },
      {
        fields: [
          ['z', 'scalar'],
          ['\u00e4', 'scalar'],
        ],
        type: '\u00e4',
      },
    ],
  });
});

test('rejects unsafe hydration values, unknown versions, and optimistic state', () => {
  expect(() => encodeHydrationValue({ map: new Map() })).toThrow(/unsupported 'Map'/);
  expect(() => encodeHydrationValue({ set: new Set() })).toThrow(/unsupported 'Set'/);
  expect(() => encodeHydrationValue({ invalid: new Date('invalid') })).toThrow(/invalid Date/);
  expect(() => encodeHydrationValue({ invalid: { [Symbol.toStringTag]: 'Date' } })).toThrow(
    /symbol-keyed property/,
  );
  expect(() => encodeHydrationValue({ value: Symbol('symbol') })).toThrow(/unsupported 'symbol'/);
  expect(() => encodeHydrationValue({ value: () => undefined })).toThrow(/unsupported 'function'/);
  expect(() => encodeHydrationValue(Array(1))).toThrow(/Sparse arrays/);

  const circular: AnyRecord = {};
  circular.circular = circular;
  expect(() => encodeHydrationValue(circular)).toThrow(/Circular references/);

  let tooDeep: AnyRecord = {};
  const deepRoot = tooDeep;
  for (let index = 0; index < 65; index += 1) {
    const next: AnyRecord = {};
    tooDeep.next = next;
    tooDeep = next;
  }
  expect(() => encodeHydrationValue(deepRoot)).toThrow(/Maximum depth/);

  const client = createClient({
    roots: {},
    transport: { fetchById: vi.fn() },
    types,
  });
  expect(() => client.hydrate({ data: ['null'], version: 2 } as never)).toThrow(
    /Unsupported hydration state version/,
  );
  expect(() =>
    client.hydrate({ data: ['null'], scope: client.dehydrate().scope, version: 1 }, {
      merge: 'invalid',
    } as never),
  ).toThrow(/Unsupported hydration merge mode/);

  client.registerOptimisticUpdate('Post:post-1', new Set(['title']));
  expect(() => client.dehydrate()).toThrow(/optimistic updates are active/);
  expect(() => client.hydrate(hydrationState(emptyHydrationState()))).toThrow(
    /optimistic updates are active/,
  );

  expect(() => decodeHydrationValue(['null', 'unexpected'])).toThrow(/Invalid hydration payload/);
  expect(() => decodeHydrationValue(['unknown'])).toThrow(/Invalid hydration payload/);
  expect(() => decodeHydrationValue(['bigint', '01'])).toThrow(/Invalid hydration payload/);
  expect(() => decodeHydrationValue(['number', Number.NaN])).toThrow(/Invalid hydration payload/);
  expect(() => decodeHydrationValue(['array', Array(1)] as never)).toThrow(
    /Invalid hydration payload/,
  );
  expect(() =>
    decodeHydrationValue([
      'object',
      [
        ['duplicate', ['null']],
        ['duplicate', ['null']],
      ],
    ]),
  ).toThrow(/Invalid hydration payload/);
});

test('rejects mismatched scopes, pending requests, and snapshots over configured limits', async () => {
  const deferred =
    Promise.withResolvers<Array<{ __typename: string; id: string; title: string }>>();
  const pending = createClient({
    hydrationScope: 'posts-v1',
    roots: {},
    transport: { fetchById: vi.fn(() => deferred.promise) },
    types,
  });
  const snapshot = createClient({
    hydrationScope: 'posts-v1',
    roots: {},
    transport: { fetchById: vi.fn() },
    types,
  }).dehydrate();
  const pendingView = view<Post>()({ id: true, title: true });
  const read = pending.readView(pendingView, pending.ref('Post', 'post-1', pendingView));
  const hydrateDuringNormalization = deferred.promise.then(() => {
    expect(() => pending.hydrate(snapshot)).toThrow(/requests are pending/);
  });

  expect(() => pending.dehydrate()).toThrow(/requests are pending/);
  expect(() => pending.hydrate(snapshot)).toThrow(/requests are pending/);
  deferred.resolve([{ __typename: 'Post', id: 'post-1', title: 'Resolved' }]);
  await Promise.all([read, hydrateDuringNormalization]);

  const otherScope = createClient({
    hydrationScope: 'posts-v2',
    roots: {},
    transport: { fetchById: vi.fn() },
    types,
  });
  expectTypeOf(snapshot).toEqualTypeOf<FateDehydratedState<'posts-v1'>>();
  const hydrateWrongScope = () => {
    // @ts-expect-error Snapshots with different literal scopes are rejected statically.
    otherScope.hydrate(snapshot);
  };
  expectTypeOf(hydrateWrongScope).toBeFunction();
  expect(() => otherScope.hydrate(snapshot as never)).toThrow(/scope does not match/);

  const limited = createClient({
    hydrationLimits: { maxCollectionLength: 2, maxNodes: 10, maxStringLength: 20 },
    roots: {},
    transport: { fetchById: vi.fn() },
    types,
  });
  const limitedScope = createClient({
    roots: {},
    transport: { fetchById: vi.fn() },
    types,
  }).dehydrate().scope;
  expect(() => limited.hydrate(hydrationState(emptyHydrationState(), limitedScope))).toThrow(
    /Invalid hydration payload/,
  );
  expect(() => encodeHydrationValue(['one', 'two'], { maxCollectionLength: 1 })).toThrow(
    /Maximum collection length/,
  );
  expect(() => encodeHydrationValue('long', { maxStringLength: 3 })).toThrow(
    /Maximum string length/,
  );
  expect(() => encodeHydrationValue(['one'], { maxNodes: 1 })).toThrow(/Maximum node count/);
  expect(() => decodeHydrationValue(['string', 'long'], { maxStringLength: 3 })).toThrow(
    /Invalid hydration payload/,
  );
  expect(() => encodeHydrationValue(null, { maxNodes: 0 })).toThrow(/positive integer/);
  expect(() =>
    createClient({
      hydrationLimits: { maxNodes: 0 },
      roots: {},
      transport: { fetchById: vi.fn() },
      types,
    }),
  ).toThrow(/positive integer/);
  expect(() =>
    createClient({
      hydrationScope: '',
      roots: {},
      transport: { fetchById: vi.fn() },
      types,
    }),
  ).toThrow(/non-empty string/);
});

test('rejects hydration while paginated connection loading is pending', async () => {
  const deferred = Promise.withResolvers<{
    items: Array<never>;
    pagination: { hasNext: boolean; hasPrevious: boolean };
  }>();
  const client = createClient({
    roots: {},
    transport: { fetchById: vi.fn(), fetchList: vi.fn(() => deferred.promise) },
    types,
  });
  const snapshot = client.dehydrate();
  const PostView = view<Post>()({ id: true, title: true });
  const loading = client.loadConnection(
    PostView,
    {
      field: 'posts',
      key: 'posts',
      owner: 'posts',
      procedure: 'posts',
      root: true,
      type: 'Post',
    },
    {},
  );

  expect(() => client.hydrate(snapshot)).toThrow(/requests are pending/);
  deferred.resolve({ items: [], pagination: { hasNext: false, hasPrevious: false } });
  await loading;
});

test('rejects hydration while root queries, root lists, and mutations are pending', async () => {
  type User = { __typename: 'User'; id: string; name: string };

  const UserView = view<User>()({ id: true, name: true });
  const PostView = view<Post>()({ id: true, title: true });
  const PostConnectionView = { items: { node: PostView } } as const;
  const queryDeferred = Promise.withResolvers<User>();
  const listDeferred = Promise.withResolvers<{
    items: Array<{ cursor: string | undefined; node: unknown }>;
    pagination: { hasNext: boolean; hasPrevious: boolean };
  }>();
  const mutationDeferred = Promise.withResolvers<unknown>();
  const client = createClient({
    roots: {
      posts: clientRoot('Post'),
      viewer: clientRoot<User, 'User'>('User'),
    },
    transport: {
      fetchById: vi.fn(),
      fetchList: vi.fn(() => listDeferred.promise),
      fetchQuery: vi.fn(() => queryDeferred.promise),
      mutate: vi.fn(() => mutationDeferred.promise) as never,
    },
    types: [...types, { fields: { name: 'scalar' }, type: 'User' }],
  });
  const snapshot = client.dehydrate();
  const query = client.request({ viewer: { view: UserView } });
  const list = client.request({ posts: { list: PostConnectionView } });
  const mutation = client.executeMutation('updatePost', {}, new Set());

  expect(() => client.hydrate(snapshot)).toThrow(/requests are pending/);
  expect(() => client.dehydrate()).toThrow(/requests are pending/);

  queryDeferred.resolve({ __typename: 'User', id: 'user-1', name: 'User' });
  listDeferred.resolve({
    items: [
      {
        cursor: undefined,
        node: { __typename: 'Post', comments: [], content: '', id: 'post-1', title: 'One' },
      },
    ],
    pagination: { hasNext: false, hasPrevious: false },
  });
  mutationDeferred.resolve({});
  await Promise.all([query, list, mutation]);

  expect(() => client.hydrate(snapshot)).not.toThrow();
});

test('releases pending hydration guards after rejected and synchronous mutation failures', async () => {
  const deferred = Promise.withResolvers<unknown>();
  const rejected = createClient({
    roots: {},
    transport: { fetchById: vi.fn(), mutate: vi.fn(() => deferred.promise) as never },
    types,
  });
  const rejectedSnapshot = rejected.dehydrate();
  const rejection = rejected.executeMutation('updatePost', {}, new Set());

  expect(() => rejected.hydrate(rejectedSnapshot)).toThrow(/requests are pending/);
  deferred.reject(new Error('failure'));
  await expect(rejection).rejects.toThrow('failure');
  expect(() => rejected.hydrate(rejectedSnapshot)).not.toThrow();

  const synchronous = createClient({
    roots: {},
    transport: {
      fetchById: vi.fn(),
      mutate: vi.fn(() => {
        throw new Error('synchronous failure');
      }) as never,
    },
    types,
  });
  const synchronousSnapshot = synchronous.dehydrate();

  await expect(synchronous.executeMutation('updatePost', {}, new Set())).rejects.toThrow(
    'synchronous failure',
  );
  expect(() => synchronous.hydrate(synchronousSnapshot)).not.toThrow();
});

test('rejects malformed snapshots atomically', () => {
  const browser = createClient({ roots: {}, transport: { fetchById: vi.fn() }, types });
  const postId = toEntityId('Post', 'post-1');
  browser.write(
    'Post',
    { __typename: 'Post', id: 'post-1', title: 'Existing' },
    new Set(['id', 'title']),
  );

  const malformed = emptyHydrationState();
  malformed.store.lists.push([
    'posts',
    { cursors: ['cursor-1', 'cursor-2'], ids: [toEntityId('Post', 'post-2')] },
  ] as never);

  expect(() => browser.hydrate(hydrationState(malformed))).toThrow(/Invalid hydration payload/);
  expect(browser.store.read(postId)?.title).toBe('Existing');

  const duplicateRecords = emptyHydrationState();
  duplicateRecords.store.records.push(
    [postId, { title: 'First' }] as never,
    [postId, { title: 'Second' }] as never,
  );
  expect(() => browser.hydrate(hydrationState(duplicateRecords))).toThrow(
    /Invalid hydration payload/,
  );
  expect(browser.store.read(postId)?.title).toBe('Existing');

  const duplicateIds = emptyHydrationState();
  duplicateIds.store.lists.push([
    'posts',
    { ids: [toEntityId('Post', 'post-2'), toEntityId('Post', 'post-2')] },
  ] as never);
  expect(() => browser.hydrate(hydrationState(duplicateIds))).toThrow(/Invalid hydration payload/);
  expect(browser.store.read(postId)?.title).toBe('Existing');

  const fractionalLimit = emptyHydrationState();
  fractionalLimit.store.lists.push(['posts', { forwardPageLimit: 1.5, ids: [] }] as never);
  expect(() => browser.hydrate(hydrationState(fractionalLimit))).toThrow(
    /Invalid hydration payload/,
  );
  expect(browser.store.read(postId)?.title).toBe('Existing');

  const unknownListField = emptyHydrationState();
  unknownListField.store.lists.push(['posts', { ids: [], unexpected: true }] as never);
  expect(() => browser.hydrate(hydrationState(unknownListField))).toThrow(
    /Invalid hydration payload/,
  );

  const malformedCoverage = emptyHydrationState();
  malformedCoverage.store.coverage.push([postId, ['metadata..title']] as never);
  expect(() => browser.hydrate(hydrationState(malformedCoverage))).toThrow(
    /Invalid hydration payload/,
  );

  const duplicateCoverage = emptyHydrationState();
  duplicateCoverage.store.coverage.push([postId, ['title', 'title']] as never);
  expect(() => browser.hydrate(hydrationState(duplicateCoverage))).toThrow(
    /Invalid hydration payload/,
  );

  const unknownPaginationField = emptyHydrationState();
  unknownPaginationField.store.lists.push([
    'posts',
    {
      ids: [],
      pagination: { hasNext: false, hasPrevious: false, unexpected: true },
    },
  ] as never);
  expect(() => browser.hydrate(hydrationState(unknownPaginationField))).toThrow(
    /Invalid hydration payload/,
  );

  expect(() =>
    browser.hydrate(hydrationState({ ...emptyHydrationState(), unexpected: true })),
  ).toThrow(/Invalid hydration payload/);
  expect(() =>
    browser.hydrate(
      hydrationState({
        ...emptyHydrationState(),
        store: { ...emptyHydrationState().store, unexpected: true },
      }),
    ),
  ).toThrow(/Invalid hydration payload/);
  expect(browser.store.read(postId)?.title).toBe('Existing');
});
