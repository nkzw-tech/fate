import { buildSchema, graphql } from 'graphql';
import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { createGraphQLArgumentSchema } from '../codegen/graphql.ts';
import { defer } from '../defer.ts';
import { getDeferredMetadata } from '../defer.ts';
import { createGraphQLTransport } from '../graphqlTransport.ts';
import { mutation } from '../mutation.ts';
import { createPersistence } from '../persistence.ts';
import type { RefetchConfig } from '../refetch.ts';
import { clientRoot } from '../root.ts';
import type { Transport } from '../transport.ts';
import { ConnectionTag, type ConnectionMetadata } from '../types.ts';
import type { ViewSelection } from '../types.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

type User = { __typename: 'User'; bio: string; friends: Array<User>; id: string; username: string };
const Name = view<User>()({ id: true });
const Profile = view<User>()({ bio: true, id: true });
const schema = buildSchema(`
  interface Node { id: ID! }
  type User implements Node { id: ID!, username: String!, bio: String!, friends(first: Int, after: String): UserConnection! }
  type UserEdge { cursor: String!, node: User! }
  type PageInfo { hasNextPage: Boolean!, hasPreviousPage: Boolean!, startCursor: String, endCursor: String }
  type UserConnection { edges: [UserEdge!]!, pageInfo: PageInfo! }
  type Query { viewer: User, user(username: String!): User, users: UserConnection!, node: Node }
  type Mutation { rename(username: String!): User! }
`);

const setup = (persistence?: ReturnType<typeof createPersistence>, withRefetch = true) => {
  const friend = { bio: 'Friend biography', id: 'User-2', username: 'friend' };
  const connection = {
    edges: [{ cursor: 'friend', node: friend }],
    pageInfo: {
      endCursor: 'friend',
      hasNextPage: true,
      hasPreviousPage: false,
      startCursor: 'friend',
    },
  };
  const user = { bio: 'Biography', friends: () => connection, id: 'User-1', username: 'cpojer' };
  const fetch = vi.fn(async (_input, init) => {
    const { query, variables } = JSON.parse(init.body);
    return new Response(
      JSON.stringify(
        await graphql({
          rootValue: {
            node: () => ({ ...user, __typename: 'User' }),
            rename: ({ username }: { username: string }) => {
              user.username = username;
              return user;
            },
            user: ({ username }: { username: string }) =>
              username === user.username ? user : username === friend.username ? friend : null,
            users: () => connection,
            viewer: () => user,
          },
          schema,
          source: query,
          variableValues: variables,
        }),
      ),
    );
  });
  const types = [
    {
      fields: { friends: { listOf: 'User' } },
      refetch: withRefetch
        ? { args: { username: { field: 'username' } }, root: 'user' }
        : undefined,
      type: 'User',
    },
    { possibleTypes: ['User'], type: 'Node' },
  ] as const;
  const roots = {
    node: clientRoot<User, 'Node'>('Node'),
    users: clientRoot<Array<User>, 'User'>('User'),
    viewer: clientRoot<User, 'User'>('User'),
  };
  const mutations = { rename: mutation<User, { username: string }, User>('User') };
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    persistence,
    roots,
    transport: createGraphQLTransport({
      fetch,
      live: false,
      mutations: { rename: { entity: 'User', field: 'rename', inputArg: false } },
      nodes: false,
      roots: {
        node: { type: 'Node' },
        user: { type: 'User' },
        users: { connection: 'relay', type: 'User' },
        viewer: { type: 'User' },
      },
      schema: createGraphQLArgumentSchema(schema),
      types,
      url: '/graphql',
    }),
    types,
  });
  return { client, fetch, user };
};

test('fetches missing fields through the configured username query without leaking the locator', async () => {
  const { client, fetch } = setup();
  const { viewer } = await client.request({ viewer: { view: Name } });
  const snapshot = await client.readView(Name, viewer!);
  expect(snapshot.data).not.toHaveProperty('username');
  expect(client.store.read('User:1')).toHaveProperty('username', 'cpojer');
  const profile = await client.readView<User, ViewSelection<typeof Profile>, typeof Profile>(
    Profile,
    client.ref('User', '1', Profile),
  );
  expect(profile.data.bio).toBe('Biography');
  expect(fetch).toHaveBeenCalledTimes(2);
  const request = JSON.parse(fetch.mock.calls[1][1].body);
  expect(request.query).toContain('user(');
  expect(Object.values(request.variables)).toContain('cpojer');
  expect(request.query).not.toContain('nodes(');
});

const recipe = { args: { username: { field: 'username' } }, root: 'user' } as const;
const native = (refetch: RefetchConfig = recipe) => {
  const pending = Promise.withResolvers<unknown>();
  const fetchById = vi.fn(async () => {
    throw new Error('Unexpected ID lookup');
  });
  const fetchQuery = vi.fn(
    (_name: string, _select: Iterable<string>, _args?: Record<string, unknown>) => pending.promise,
  );
  const client = createClient({
    roots: { first: clientRoot<User, 'User'>('User'), second: clientRoot<User, 'User'>('User') },
    transport: { fetchById, fetchQuery },
    types: [{ refetch, type: 'User' }],
  });
  client.write(
    'User',
    { __typename: 'User', id: '1', username: 'old' },
    new Set(['id', 'username']),
  );
  return { client, fetchById, fetchQuery, pending };
};
const identityRequest = { first: { id: '1', view: Profile } };

test('deduplicates pending locator queries across requests and never falls back to IDs', async () => {
  const { client, fetchById, fetchQuery, pending } = native();
  const first = client.request(identityRequest);
  const second = client.request({ second: { id: '1', view: Profile } });
  expect(fetchQuery).toHaveBeenCalledTimes(1);
  expect(fetchQuery.mock.calls[0][0]).toBe('user');
  expect(fetchQuery.mock.calls[0][2]).toEqual({ username: 'old' });
  pending.resolve({ __typename: 'User', bio: 'Biography', id: '1', username: 'old' });
  await Promise.all([first, second]);
  expect(fetchById).not.toHaveBeenCalled();
});

test('uses confirmed locator fields while an optimistic rename is pending and after rollback', async () => {
  const { client, fetchQuery, pending } = native();
  const rollback = client.store.optimisticUpdate(() =>
    client.write('User', { id: '1', username: 'optimistic' }, new Set(['username'])),
  );
  const request = client.request(identityRequest, { mode: 'network-only' });
  expect(fetchQuery.mock.calls[0][2]).toEqual({ username: 'old' });
  pending.resolve({ __typename: 'User', bio: 'Biography', id: '1', username: 'old' });
  await request;
  expect(client.store.read('User:1')?.username).toBe('optimistic');
  rollback();
  expect(client.store.read('User:1')?.username).toBe('old');
});

test('confirmed renames change query arguments without changing existing references', async () => {
  const { client, fetchQuery, pending } = native();
  const ref = client.ref('User', '1', Profile);
  client.write('User', { id: '1', username: 'new' }, new Set(['username']));
  const request = client.request(identityRequest, { mode: 'network-only' });
  expect(fetchQuery.mock.calls[0][2]).toEqual({ username: 'new' });
  pending.resolve({ __typename: 'User', bio: 'Biography', id: '1', username: 'new' });
  await request;
  expect(ref).toBe(client.ref('User', '1', Profile));
});

test.each([
  { __typename: 'User', bio: 'Someone else', id: '2', username: 'old' },
  { __typename: 'Other', bio: 'Wrong type', id: '1', username: 'old' },
])('rejects mismatched identities before any normalization: %j', async (result) => {
  const { client, pending } = native();
  const request = client.request(identityRequest);
  pending.resolve(result);
  await expect(request).rejects.toThrow('returned a different entity');
  expect(client.store.read('User:1')).not.toHaveProperty('bio');
  expect(client.store.read('User:2')).toBeUndefined();
  expect(client.store.read('Other:1')).toBeUndefined();
});

test('a stale username lookup reports not found without deleting the cached entity', async () => {
  const { client, pending } = native();
  const request = client.request(identityRequest);
  pending.resolve(null);
  await expect(request).rejects.toThrow('Refresh its parent query');
  expect(client.store.read('User:1')).toHaveProperty('username', 'old');
});

test('cold IDs require an authoritative root query to acquire their locator', async () => {
  const { client, fetchById, fetchQuery } = native();
  await expect(client.request({ first: { id: '2', view: Profile } })).rejects.toThrow(
    'missing confirmed locator',
  );
  expect(fetchById).not.toHaveBeenCalled();
  expect(fetchQuery).not.toHaveBeenCalled();
});

test('supports composite and nested input projections and serializable constants', async () => {
  const { client, fetchQuery, pending } = native({
    args: {
      input: {
        object: { locale: { value: 'en' }, tenant: { value: 7 }, username: { field: 'username' } },
      },
    },
    root: 'lookup',
  });
  const request = client.request(identityRequest);
  expect(fetchQuery.mock.calls[0][2]).toEqual({
    input: { locale: 'en', tenant: 7, username: 'old' },
  });
  pending.resolve({ __typename: 'User', bio: 'Biography', id: '1', username: 'old' });
  await request;
});

test('an old response cannot undo a confirmed rename', async () => {
  const { client, pending } = native();
  const request = client.request(identityRequest);
  client.write('User', { id: '1', username: 'new' }, new Set(['username']));
  pending.resolve({ __typename: 'User', bio: 'Biography', id: '1', username: 'old' });
  await request;
  expect(client.store.read('User:1')).toMatchObject({ bio: 'Biography', username: 'new' });
});

test('deferred fields use the same locator query', async () => {
  const { client, fetch } = setup();
  const Deferred = view<User>()({ bio: defer(true), id: true });
  const { viewer } = await client.request({ viewer: { view: Deferred } });
  const snapshot = await client.readView<User, ViewSelection<typeof Deferred>, typeof Deferred>(
    Deferred,
    viewer!,
  );
  const metadata = getDeferredMetadata(snapshot.data.bio);
  expect(metadata).toBeDefined();
  const value = await client.readDeferred(snapshot.data.bio);
  expect(value.data).toBe('Biography');
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('persists implicit locator fields for refetches after reload', async () => {
  const storage = memoryStorage();
  const first = setup(createPersistence({ key: 'refetch-user', storage }));
  await first.client.request({ viewer: { view: Name } });
  await first.client.persistence!.flush();
  first.client.persistence!.dispose();
  const second = setup(createPersistence({ key: 'refetch-user', storage }));
  const { viewer } = await second.client.request({ viewer: { view: Name } });
  expect(second.fetch).not.toHaveBeenCalled();
  expect(second.client.store.read('User:1')).toHaveProperty('username', 'cpojer');
  await second.client.readView<User, ViewSelection<typeof Profile>, typeof Profile>(
    Profile,
    second.client.ref('User', viewer!.id, Profile),
  );
  expect(second.fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(second.fetch.mock.calls[0][1].body).query).toContain('user(');
  second.client.persistence!.dispose();
});

test('includes locators in root connections and refetches multiple users in one GraphQL request', async () => {
  const { client, fetch } = setup();
  await client.request({ users: { list: Name } });
  expect(client.store.read('User:2')).toHaveProperty('username', 'friend');
  // Acquire the viewer through its root before looking it up by cache identity.
  await client.request({ viewer: { view: Name } });
  fetch.mockClear();
  await client.request({ users: { ids: ['1', '2'], view: Profile } }, { mode: 'network-only' });
  expect(fetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(Object.values(body.variables).sort()).toEqual(['cpojer', 'friend']);
  expect(body.query.match(/user\(/g)).toHaveLength(2);
});

test('includes concrete locator fields when an entity is returned through an interface', async () => {
  const { client, fetch } = setup();
  await client.request({ node: { view: Name } });
  expect(client.store.read('User:1')).toHaveProperty('username', 'cpojer');
  expect(JSON.parse(fetch.mock.calls[0][1].body).query).toContain('... on User');
});

test('mutation responses carry implicit locators even when the view selects only identity', async () => {
  const { client } = setup();
  await client.request({ viewer: { view: Name } });
  await client.mutations.rename({ input: { username: 'renamed' }, view: Name });
  expect(client.store.read('User:1')).toHaveProperty('username', 'renamed');
  await client.request({ users: { id: '1', view: Profile } });
  expect(client.store.read('User:1')).toHaveProperty('bio', 'Biography');
});

test('nested pagination fetches its owner through the locator query', async () => {
  const { client, fetch } = setup();
  const Friends = view<User>()({ friends: { args: { first: 1 }, items: { node: Name } } });
  const { viewer } = await client.request({ viewer: { view: Friends } });
  const snapshot = await client.readView<User, ViewSelection<typeof Friends>, typeof Friends>(
    Friends,
    viewer!,
  );
  const metadata = (snapshot.data.friends as unknown as { [ConnectionTag]: ConnectionMetadata })[
    ConnectionTag
  ];
  fetch.mockClear();
  await client.loadConnection(Name, metadata, { after: 'friend', first: 1 });
  expect(fetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.query).toContain('user(');
  expect(body.query).toContain('friends(');
  expect(Object.values(body.variables)).toEqual(expect.arrayContaining(['cpojer', 'friend', 1]));
});

test('failed locator lookups can be retried without retaining a rejected promise', async () => {
  const { client, fetchQuery } = native();
  fetchQuery.mockRejectedValueOnce(new Error('offline'));
  await expect(client.request(identityRequest, { mode: 'network-only' })).rejects.toThrow(
    'offline',
  );
  fetchQuery.mockResolvedValueOnce({
    __typename: 'User',
    bio: 'Biography',
    id: '1',
    username: 'old',
  });
  await client.request(identityRequest, { mode: 'network-only' });
  expect(fetchQuery).toHaveBeenCalledTimes(2);
});

test('adding a refetch recipe preserves delivery of an existing durable mutation journal', async () => {
  const storage = memoryStorage();
  const roots = { user: clientRoot<User, 'User'>('User') };
  const mutations = { edit: mutation<User, { bio: string; id: string }, User>('User') };
  const deliver = vi.fn(async (_key: string, input: { bio: string; id: string }) => ({
    ...input,
    __typename: 'User' as const,
    friends: [],
    username: 'old',
  }));
  const transport: Transport<{ edit: { input: { bio: string; id: string }; output: User } }> = {
    fetchById: async () => [],
    fetchQuery: async () => null,
    mutateDurably: deliver,
  };
  const create = (refetch?: RefetchConfig) =>
    createClient<[typeof roots, typeof mutations]>({
      mutations,
      persistence: createPersistence({
        key: 'recipe-upgrade',
        online: () => Boolean(refetch),
        storage,
      }),
      roots,
      transport,
      types: [{ refetch, type: 'User' }],
    });
  const first = create();
  const second = { client: undefined as ReturnType<typeof create> | undefined };
  try {
    await first.persistence!.ready;
    const sending = first.mutations
      .edit({ input: { bio: 'Queued', id: '1' } })
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(first.persistence!.getSnapshot().mutations).toHaveLength(1));
    first.persistence!.dispose();
    expect(await sending).toBeInstanceOf(Error);
    second.client = create(recipe);
    expect(first.getPersistenceScope()).toBe(second.client.getPersistenceScope());
    await second.client.persistence!.ready;
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
    await second.client.persistence!.flush();
    expect(second.client.store.read('User:1')).toMatchObject({ bio: 'Queued', username: 'old' });
  } finally {
    first.persistence!.dispose();
    second.client?.persistence!.dispose();
  }
});

test('constant queries can refetch cold identities while still checking the returned identity', async () => {
  const { client, fetchQuery, pending } = native({ args: {}, root: 'viewer' });
  const request = client.request({ first: { id: '7', view: Profile } });
  expect(fetchQuery.mock.calls[0][2]).toEqual({});
  pending.resolve({ __typename: 'User', bio: 'Biography', id: '7', username: 'viewer' });
  await request;
});

test('retaining a request retains its locator and releasing it permits garbage collection', async () => {
  const { client } = setup();
  const request = { viewer: { view: Name } };
  const retained = client.retain(request);
  await client.request(request);
  client.gc();
  expect(client.store.read('User:1')).toHaveProperty('username', 'cpojer');
  retained.dispose();
});

test('an older persisted record missing a locator is refreshed through its authoritative root', async () => {
  const storage = memoryStorage();
  const first = setup(createPersistence({ key: 'add-locator', storage }), false);
  await first.client.request({ viewer: { view: Name } });
  expect(first.client.store.read('User:1')).not.toHaveProperty('username');
  await first.client.persistence!.flush();
  first.client.persistence!.dispose();
  const second = setup(createPersistence({ key: 'add-locator', storage }));
  try {
    await second.client.request({ viewer: { view: Name } });
    expect(second.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(second.fetch.mock.calls[0][1].body).query).toContain('viewer');
    expect(second.client.store.read('User:1')).toHaveProperty('username', 'cpojer');
  } finally {
    second.client.persistence!.dispose();
  }
});

test('encodes projected IDs for automatic refetches without changing ordinary root arguments', async () => {
  const idSchema = buildSchema(
    'type User { id: ID!, bio: String! } type Query { lookup(id: ID!): User }',
  );
  const lookup = vi.fn(({ id }: { id: string }) =>
    id === 'User-1' ? { bio: 'Biography', id } : null,
  );
  const fetch = vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    return new Response(
      JSON.stringify(
        await graphql({
          rootValue: { lookup },
          schema: idSchema,
          source: body.query,
          variableValues: body.variables,
        }),
      ),
    );
  });
  const types = [
    { refetch: { args: { id: { field: 'id' } }, root: 'lookup' }, type: 'User' },
  ] as const;
  const transport = createGraphQLTransport({
    fetch,
    live: false,
    nodes: false,
    roots: { lookup: { type: 'User' } },
    schema: createGraphQLArgumentSchema(idSchema),
    types,
    url: '/graphql',
  });
  const roots = { lookup: clientRoot<User, 'User'>('User') };
  const client = createClient<[typeof roots, Record<never, never>]>({ roots, transport, types });
  await client.request({ lookup: { args: { id: 'User-1' }, view: Name } });
  await client.request({ lookup: { id: '1', view: Profile } });
  await transport.fetchQuery!('lookup', new Set(['bio']), { id: 'User-1' });
  expect(lookup.mock.calls.map(([args]) => args.id)).toEqual(['User-1', 'User-1', 'User-1']);
  expect(client.store.read('User:1')).toHaveProperty('bio', 'Biography');
});

test('deduplicated refetches retain their original generation across newer confirmed writes', async () => {
  const { client, fetchQuery, pending } = native();
  const first = client.request(identityRequest, { mode: 'network-only' });
  client.write('User', { bio: 'Confirmed', id: '1' }, new Set(['bio']));
  const second = client.request({ second: { id: '1', view: Profile } }, { mode: 'network-only' });
  expect(fetchQuery).toHaveBeenCalledTimes(1);
  pending.resolve({ __typename: 'User', bio: 'Stale', id: '1', username: 'old' });
  await Promise.all([first, second]);
  expect(client.store.read('User:1')).toHaveProperty('bio', 'Confirmed');
});

test('a pagination refresh cannot reuse an older shared response to restore its previous window', async () => {
  const { client, fetch, user } = setup();
  const initialFriends = user.friends;
  user.friends = (args?: { after?: string }) =>
    args?.after
      ? {
          edges: [{ cursor: 'stale', node: { bio: 'Old page', id: 'User-4', username: 'stale' } }],
          pageInfo: {
            endCursor: 'stale',
            hasNextPage: true,
            hasPreviousPage: true,
            startCursor: 'stale',
          },
        }
      : initialFriends();
  const Friends = view<User>()({ friends: { args: { first: 1 }, items: { node: Name } } });
  const request = { viewer: { view: Friends } };
  const { viewer } = await client.request(request);
  const snapshot = await client.readView<User, ViewSelection<typeof Friends>, typeof Friends>(
    Friends,
    viewer!,
  );
  const metadata = (snapshot.data.friends as unknown as { [ConnectionTag]: ConnectionMetadata })[
    ConnectionTag
  ];
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const execute = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (url, init) => {
    const response = await execute(url, init);
    if (JSON.parse(init.body).query.includes('user(')) {
      started.resolve();
      await release.promise;
    }
    return response;
  });
  const oldPage = client.loadConnection(Name, metadata, { after: 'friend', first: 1 });
  await started.promise;
  user.friends = () => ({
    edges: [{ cursor: 'fresh', node: { bio: 'Fresh', id: 'User-3', username: 'fresh' } }],
    pageInfo: {
      endCursor: 'fresh',
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: 'fresh',
    },
  });
  await client.request(request, { mode: 'network-only' });
  const refreshed = client.store.getListState(metadata.key);
  expect(refreshed?.ids).not.toContain('User:4');
  const newPage = client.loadConnection(Name, metadata, { after: 'friend', first: 1 });
  expect(fetch).toHaveBeenCalledTimes(3);
  release.resolve();
  await Promise.all([oldPage, newPage]);
  expect(client.store.getListState(metadata.key)).toBe(refreshed);
});
