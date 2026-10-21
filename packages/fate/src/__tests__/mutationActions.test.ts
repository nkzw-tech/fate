import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { initTRPC } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { buildSchema, graphql } from 'graphql';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { z } from 'zod';
import { alias } from '../alias.ts';
import { createClient } from '../client.ts';
import type { GraphQLSelectedResult } from '../graphql-types.ts';
import { createGraphQLTransport } from '../graphqlTransport.ts';
import { createHTTPTransport } from '../httpTransport.ts';
import { mutation, valueMutation } from '../mutation.ts';
import { toEntityId } from '../ref.ts';
import { createSourceRegistry } from '../server/executor.ts';
import { createFateServer, type InferFateAPI } from '../server/http.ts';
import { createTRPCTransport } from '../transport.ts';
import { view } from '../view.ts';

type Author = { __typename: 'Author'; id: string; name: string };
type Note = { __typename: 'Note'; author: Author; id: string; title: string };
const TitleView = view<Note>()({ title: true });
const AuthorView = view<Note>()({ author: { name: true } });
const input = { id: '1', title: 'Confirmed' };
const note: Note = {
  __typename: 'Note',
  author: { __typename: 'Author', id: 'author', name: 'Ada' },
  ...input,
};

const setup = () => {
  const mutate = vi.fn().mockResolvedValue(note);
  const mutations = {
    edit: mutation<Note, typeof input, GraphQLSelectedResult<Note | null>>('Note'),
    receipt: valueMutation<
      object,
      GraphQLSelectedResult<{ __typename: 'Receipt'; code: string }>
    >(),
  };
  const roots = {};
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport: { fetchById: async () => [], mutate },
    types: [{ fields: { author: { type: 'Author' } }, type: 'Note' }, { type: 'Author' }],
  });
  return { client, mutate };
};

test('expands action selections without changing the original action', async () => {
  const { client, mutate } = setup();
  const title = client.actions.edit.with(TitleView);
  const expanded = title.with(AuthorView).with({ author: { id: true } });
  const submission = expanded(null, { input, optimistic: { title: 'Optimistic' } });
  expect(client.store.read(toEntityId('Note', '1'))?.title).toBe('Optimistic');
  const response = await submission;
  expect(response).toEqual({ error: undefined, result: note });
  expect(new Set(mutate.mock.calls[0][2])).toEqual(
    new Set(['id', 'title', 'author.name', 'author.id']),
  );
  expect(client.store.read(toEntityId('Author', 'author'))?.name).toBe('Ada');
  if (!response.error && response.result) {
    expectTypeOf(response.result.title).toEqualTypeOf<string>();
    expectTypeOf(response.result.author.name).toEqualTypeOf<string>();
    expectTypeOf(response.result.author.id).toEqualTypeOf<string>();
  }
  await title(null, { input });
  expect(new Set(mutate.mock.calls[1][2])).toEqual(new Set(['title']));
  await client.actions.edit(null, { input });
  expect(new Set(mutate.mock.calls[2][2])).toEqual(new Set());
  await expect(expanded(response, 'reset')).resolves.toBeNull();
  expect(mutate).toHaveBeenCalledTimes(3);
});

test('selects value object results and preserves nullable entity results', async () => {
  const { client, mutate } = setup();
  mutate.mockResolvedValueOnce({ __typename: 'Receipt', code: 'paid' });
  const receipt = await client.actions.receipt.with({ code: true })(null, { input: {} });
  if (!receipt.error) {
    expectTypeOf(receipt.result.code).toEqualTypeOf<string>();
  }
  expect(receipt).toEqual({ error: undefined, result: { __typename: 'Receipt', code: 'paid' } });
  expect(new Set(mutate.mock.calls[0][2])).toEqual(new Set(['code']));
  mutate.mockResolvedValueOnce(null);
  await expect(client.actions.edit.with(TitleView)(null, { input })).resolves.toEqual({
    error: undefined,
    result: null,
  });
});

test('native action selections narrow entity and plain value results without changing unbound actions', async () => {
  const mutate = vi.fn().mockResolvedValue(note);
  const mutations = {
    edit: mutation<Note, typeof input, Note | null>('Note'),
    plain: mutation<Note, typeof input, Omit<Note, '__typename'> | null>('Note'),
    receipt: valueMutation<object, { code: string; internal: string }>(),
  };
  const roots = {};
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport: { fetchById: async () => [], mutate },
    types: [{ fields: { author: { type: 'Author' } }, type: 'Note' }, { type: 'Author' }],
  });
  const title = await client.actions.edit.with(TitleView)(null, { input });
  if (!title.error && title.result) {
    expectTypeOf(title.result).toEqualTypeOf<{ __typename: 'Note'; id: string; title: string }>();
    // @ts-expect-error Native entity actions only expose fields selected by the bound action.
    void title.result.author;
  }
  const plain = await client.actions.plain.with(TitleView).with(AuthorView)(null, { input });
  if (!plain.error && plain.result) {
    expectTypeOf(plain.result.author.name).toEqualTypeOf<string>();
    expectTypeOf(plain.result.author.id).toEqualTypeOf<string>();
    expectTypeOf(plain.result.author.__typename).toEqualTypeOf<'Author'>();
    expectTypeOf(plain.result.title).toEqualTypeOf<string>();
    // @ts-expect-error Return typing must not invent a typename omitted from the native contract.
    void plain.result.__typename;
  }
  const unbound = await client.actions.edit(null, { input });
  if (!unbound.error && unbound.result) {
    expectTypeOf(unbound.result).toEqualTypeOf<Note>();
  }
  mutate.mockResolvedValueOnce({ code: 'paid', internal: 'private' });
  const receipt = await client.actions.receipt.with({ code: true })(null, { input: {} });
  if (!receipt.error) {
    expectTypeOf(receipt.result).toEqualTypeOf<{ code: string }>();
    // @ts-expect-error Plain object results also hide unselected fields.
    void receipt.result.internal;
  }
});

test.each(['http', 'trpc'] as const)(
  'forwards bound selections through %s mutations',
  async (kind) => {
    const resolve = vi.fn((_input: { id: string }, _select: Array<string>) => note);
    const mutations = { edit: mutation<Note, typeof input, Note>('Note') };
    const roots = {};
    const types = [{ fields: { author: { type: 'Author' } }, type: 'Note' }, { type: 'Author' }];
    const server = createFateServer({
      mutations: {
        edit: {
          resolve: ({ input: variables, select }: { input: typeof input; select: Array<string> }) =>
            resolve(variables, select),
          type: 'Note',
        },
      },
      roots,
      sources: {
        getSource: () => {
          throw new Error('This test only executes mutations.');
        },
        registry: createSourceRegistry([]),
      },
    });
    const t = initTRPC.create();
    const router = t.router({
      edit: t.procedure
        .input(z.object({ id: z.string(), select: z.array(z.string()), title: z.string() }))
        .mutation(({ input }) => resolve(input, input.select)),
    });
    const rpcClient = createTRPCClient<typeof router>({
      links: [
        httpBatchLink({
          fetch: (input, init) =>
            fetchRequestHandler({ endpoint: '/trpc', req: new Request(input, init), router }),
          url: 'http://test.local/trpc',
        }),
      ],
    });
    const rpcMutations = { edit: (client: typeof rpcClient) => client.edit.mutate };
    const transport =
      kind === 'http'
        ? createHTTPTransport<InferFateAPI<typeof server>>({
            fetch: (input, init) => server.handleRequest(new Request(input, init)),
            live: false,
            url: 'http://test.local/fate',
          })
        : createTRPCTransport<typeof router, typeof rpcMutations>({
            byId: {},
            client: rpcClient,
            mutations: rpcMutations,
          });
    const client = createClient<[typeof roots, typeof mutations]>({
      mutations,
      roots,
      transport,
      types,
    });
    const response = await client.actions.edit.with(TitleView).with(AuthorView)(null, { input });
    expect(response).toEqual({ error: undefined, result: note });
    if (!response.error) {
      expectTypeOf(response.result.title).toEqualTypeOf<string>();
      expectTypeOf(response.result.author.name).toEqualTypeOf<string>();
    }
    expect(resolve).toHaveBeenCalledOnce();
    expect(new Set(resolve.mock.calls[0][1])).toEqual(new Set(['title', 'author.name']));
    expect(client.store.read(toEntityId('Author', 'author'))?.name).toBe('Ada');
  },
);

test('fetches the expanded GraphQL selection and normalizes its nested fields', async () => {
  const schema = buildSchema(`
    type Author { id: ID!, name: String! }
    type Note { id: ID!, title: String!, author: Author! }
    type Query { note: Note }
    type Mutation { edit(id: ID!, title: String!): Note }
  `);
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const result = await graphql({
      rootValue: { edit: () => note },
      schema,
      source: body.query,
      variableValues: body.variables,
    });
    expect(result.errors).toBeUndefined();
    return new Response(JSON.stringify(result));
  });
  const types = [{ fields: { author: { type: 'Author' } }, type: 'Note' }, { type: 'Author' }];
  const mutations = {
    edit: mutation<Note, typeof input, GraphQLSelectedResult<Note | null>>('Note'),
  };
  const roots = {};
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport: createGraphQLTransport({
      decodeNodeId: (_, id) => id,
      encodeNodeId: (_, id) => id,
      fetch,
      live: false,
      mutations: { edit: { entity: 'Note', field: 'edit', inputArg: false } },
      types,
      url: '/graphql',
    }),
    types,
  });
  const response = await client.actions.edit.with(TitleView).with(AuthorView)(null, { input });
  expect(response).toMatchObject({
    error: undefined,
    result: { author: { id: 'author', name: 'Ada' }, id: '1', title: 'Confirmed' },
  });
  expect(client.store.read(toEntityId('Author', 'author'))?.name).toBe('Ada');
  expect(fetch).toHaveBeenCalledOnce();
});

test('rejects conflicting bound field arguments and execution-time selection overrides', async () => {
  type Map = { __typename: 'Map'; id: string; state: string };
  const mutate = vi.fn();
  const mutations = { edit: mutation<Map, object, Map>('Map') };
  const roots = {};
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport: { fetchById: async () => [], mutate, supportsAliases: true },
    types: [{ type: 'Map' }],
  });
  const action = client.actions.edit.with({ state: { args: { biome: 'Grassland' } } });
  expect(() => action.with({ state: { args: { biome: 'Desert' } } })).toThrow(
    /Conflicting arguments/,
  );
  await expect(
    // @ts-expect-error Bound selections cannot be overridden by individual dispatches.
    action(null, { input: {}, view: view<Map>()({ id: true }) }),
  ).rejects.toThrow(/selection.*with/i);
  await expect(
    // @ts-expect-error Raw selections cannot override the fixed action selection either.
    action(null, { input: {}, select: { id: true } }),
  ).rejects.toThrow(/selection.*with/i);
  expect(mutate).not.toHaveBeenCalled();
  const StateView = view<Map>()(({ biome }: { biome: string }) => ({
    state: { args: { biome } },
  }));
  // @ts-expect-error Parameterized views must be bound before being used as selections.
  expect(() => client.actions.edit.with(StateView)).toThrow(/parameters bound/);
  const aliased = action.with({ desert: alias('state', { args: { biome: 'Desert' } }) });
  mutate.mockResolvedValueOnce({ 'desert:state': 'desert', id: '1', state: 'grassland' });
  await aliased(null, { input: { id: '1' } });
  expect(new Set(mutate.mock.calls[0][2])).toEqual(new Set(['state', 'desert:state']));
  expect(mutate.mock.calls[0][1]).toEqual({
    args: { 'desert:state': { biome: 'Desert' }, state: { biome: 'Grassland' } },
    id: '1',
  });
  mutate.mockResolvedValueOnce({ id: '1', state: 'grassland' });
  await client.actions.edit.with(StateView({ biome: 'Grassland' }))(null, { input: { id: '1' } });
  expect(mutate.mock.calls[1][1]).toEqual({ args: { state: { biome: 'Grassland' } }, id: '1' });
});
