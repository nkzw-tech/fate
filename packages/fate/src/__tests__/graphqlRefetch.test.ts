import { buildSchema, graphql } from 'graphql';
import { expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { createGraphQLArgumentSchema } from '../codegen/graphql.ts';
import { createGraphQLTransport, type GraphQLTransportOptions } from '../graphqlTransport.ts';
import { clientRoot } from '../root.ts';
import { ConnectionTag, type ConnectionMetadata, type SelectionOf } from '../types.ts';
import { view } from '../view.ts';

const refetchSchema = buildSchema(`
  enum Status { Active Waiting }
  type Query { viewer: User fetch__User(key: ID!): User }
  type User { id: ID! name: String! games(first: Int!, after: String, status: Status!): GameConnection! }
  type Game { id: ID! name: String! }
  type GameConnection { edges: [GameEdge!]! pageInfo: PageInfo! }
  type GameEdge { cursor: String! node: Game! }
  type PageInfo { endCursor: String startCursor: String hasNextPage: Boolean! hasPreviousPage: Boolean! }
`);

const createRefetchTransport = (options: Partial<GraphQLTransportOptions> = {}) => {
  const games = vi.fn(({ after }: { after?: string }) => ({
    edges: [
      { cursor: after ? 'two' : 'one', node: { id: after ? 'Game-2' : 'Game-1', name: 'Game' } },
    ],
    pageInfo: { endCursor: after ? 'two' : 'one', hasNextPage: !after, hasPreviousPage: false },
  }));
  const user = (id: string) => ({ games, id, name: id });
  const fetchUser = vi.fn(({ key }: { key: string }) => {
    if (key === 'User-error') {
      throw new Error('Refetch failed');
    }
    return key === 'User-missing' ? null : user(key);
  });
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { query, variables } = JSON.parse(String(init?.body));
    const result = await graphql({
      rootValue: { fetch__User: fetchUser, viewer: () => user('User-1') },
      schema: refetchSchema,
      source: query,
      variableValues: variables,
    });
    return new Response(JSON.stringify(result), {
      headers: { 'content-type': 'application/json' },
    });
  });
  const transport = createGraphQLTransport({
    byId: { User: { field: 'fetch__User', idArg: 'key' } },
    fetch,
    live: false,
    nodes: false,
    roots: { viewer: { type: 'User' } },
    schema: createGraphQLArgumentSchema(refetchSchema),
    types: [{ fields: { games: { listOf: 'Game' } }, type: 'User' }, { type: 'Game' }],
    url: '/graphql',
    ...options,
  });
  return { fetch, fetchUser, games, transport };
};

test('batches mapped refetches with typed ID variables and omits missing records', async () => {
  const { fetch, fetchUser, transport } = createRefetchTransport();
  await expect(
    transport.fetchById('User', ['2', 'missing', '1'], new Set(['name'])),
  ).resolves.toEqual([
    { __typename: 'User', id: '2', name: 'User-2' },
    { __typename: 'User', id: '1', name: 'User-1' },
  ]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetchUser.mock.calls.map(([args]) => args.key)).toEqual([
    'User-2',
    'User-missing',
    'User-1',
  ]);
  const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
  expect(body.query).not.toContain('nodes(');
  expect(body.query).toMatch(/\$\w+: ID!/);
  expect(Object.values(body.variables)).toEqual(['User-2', 'User-missing', 'User-1']);
});

test('prefers mapped refetches over the default nodes fallback and supports literal arguments', async () => {
  const { transport } = createRefetchTransport({ nodes: true, schema: undefined });
  await expect(transport.fetchById('User', ['1'], new Set(['name']))).resolves.toMatchObject([
    { id: '1' },
  ]);
});

test('honors identity codecs for applications using opaque global IDs', async () => {
  const { fetchUser, transport } = createRefetchTransport({
    decodeNodeId: (_type, id) => id,
    encodeNodeId: (_type, id) => id,
  });
  await expect(transport.fetchById('User', ['User-1'], new Set(['name']))).resolves.toMatchObject([
    { id: 'User-1' },
  ]);
  expect(fetchUser.mock.calls[0][0]).toEqual({ key: 'User-1' });
});

test('reports missing mappings without network requests when nodes are disabled', () => {
  const { fetch, transport } = createRefetchTransport();
  expect(() => transport.fetchById('Game', ['1'], new Set(['name']))).toThrow(/No.*refetch.*Game/);
  expect(fetch).not.toHaveBeenCalled();
});

test('does not issue a request for an empty ID list', async () => {
  const { fetch, transport } = createRefetchTransport();
  await expect(transport.fetchById('User', [], new Set(['name']))).resolves.toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

test('isolates mapped refetch errors from other operations in the same batch', async () => {
  const { fetch, transport } = createRefetchTransport();
  const results = await Promise.allSettled([
    transport.fetchById('User', ['error'], new Set(['name'])),
    transport.fetchById('User', ['1'], new Set(['name'])),
  ]);
  expect(results[0]).toMatchObject({
    reason: { message: 'Refetch failed', name: 'GraphQLRequestError' },
    status: 'rejected',
  });
  expect(results[1]).toMatchObject({ status: 'fulfilled', value: [{ id: '1' }] });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('paginates a nested connection through a mapped refetch without leaking the owner ID', async () => {
  type Game = { __typename: 'Game'; id: string; name: string };
  type User = { __typename: 'User'; games: Array<Game>; id: string };
  const { fetch, fetchUser, games, transport } = createRefetchTransport();
  const client = createClient({
    roots: { viewer: clientRoot<User, 'User'>('User') },
    transport,
    types: [{ fields: { games: { listOf: 'Game' } }, type: 'User' }, { type: 'Game' }],
  });
  const GameView = view<Game>()({ id: true, name: true });
  const UserView = view<User>()({
    games: { args: { first: 1, status: 'Active' }, items: { node: GameView } },
    id: true,
  });
  const { viewer } = await client.request({ viewer: { view: UserView } });
  const initial = await client.readView<User, SelectionOf<typeof UserView>, typeof UserView>(
    UserView,
    viewer,
  );
  const metadata = (
    initial.data.games as typeof initial.data.games & { [ConnectionTag]: ConnectionMetadata }
  )[ConnectionTag];

  await client.loadConnection(GameView, metadata, { after: 'one' });

  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetchUser.mock.calls[0][0]).toEqual({ key: 'User-1' });
  expect(games.mock.calls.map(([args]) => args)).toEqual([
    { first: 1, status: 'Active' },
    { after: 'one', first: 1, status: 'Active' },
  ]);
  const next = await client.readView<User, SelectionOf<typeof UserView>, typeof UserView>(
    UserView,
    viewer,
  );
  expect(next.data.games.items.map(({ node }) => node.id)).toEqual(['1', '2']);
});

test('retains the default nodes fallback for types without a mapping', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(
        JSON.stringify({ data: { f1: [{ __typename: 'Game', id: 'Game-1', name: 'Game' }] } }),
      ),
  );
  const { transport } = createRefetchTransport({ fetch, nodes: undefined, schema: undefined });
  await expect(transport.fetchById('Game', ['1'], new Set(['name']))).resolves.toEqual([
    { __typename: 'Game', id: '1', name: 'Game' },
  ]);
  expect(fetch).toHaveBeenCalledTimes(1);
  const init = fetch.mock.calls[0];
  expect(JSON.parse(String(init[1]?.body)).query).toContain('nodes(ids: ["Game-1"])');
});

test('defaults the mapped ID argument to id', async () => {
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(JSON.parse(String(init?.body)).query).toContain('user(id: "User-1")');
    return new Response(JSON.stringify({ data: { f1: { __typename: 'User', id: 'User-1' } } }));
  });
  const { transport } = createRefetchTransport({
    byId: { User: { field: 'user' } },
    fetch,
    schema: undefined,
  });
  await expect(transport.fetchById('User', ['1'], new Set(['id']))).resolves.toEqual([
    { __typename: 'User', id: '1' },
  ]);
});

test.each([
  [{ User: { field: 'missing' } }, /Query.missing/],
  [{ User: { field: 'fetch__User', idArg: 'id' } }, /Query.fetch__User.id/],
  [{ User: { field: 'invalid-field' } }, /Invalid refetch identifier/],
])('validates refetch mappings for directly constructed transports: %j', (byId, error) => {
  expect(() => createRefetchTransport({ byId })).toThrow(error);
});
