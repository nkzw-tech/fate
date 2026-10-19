import { buildSchema, graphql, parse } from 'graphql';
import { expect, test, vi } from 'vite-plus/test';
import { createGraphQLArgumentSchema } from '../codegen/graphql.ts';
import { createGraphQLTransport } from '../graphqlTransport.ts';

const errors = [
  { extensions: { code: 'FORBIDDEN' }, message: 'Private field', path: ['f1', 'email'] },
  { extensions: { code: 'FAILED' }, message: 'Other field', path: ['f1', 'name'] },
];

const transportWith = (body: unknown, status = 200) =>
  createGraphQLTransport({
    fetch: async () => new Response(JSON.stringify(body), { status }),
    live: false,
    roots: { viewer: { type: 'User' } },
    types: [{ type: 'User' }],
    url: '/graphql',
  });

test('retains all execution errors and partial data without accepting an incomplete result', async () => {
  const transport = transportWith({ data: { f1: { id: 'User-1', name: null } }, errors });
  await expect(transport.fetchQuery!('viewer', new Set(['name']))).rejects.toMatchObject({
    data: { id: 'User-1', name: null },
    errors,
    extensions: { code: 'FORBIDDEN' },
    message: 'Private field',
    name: 'GraphQLRequestError',
    path: ['f1', 'email'],
    status: 200,
  });
});

test('retains HTTP status and GraphQL errors for a failed HTTP response', async () => {
  const transport = transportWith({ errors }, 403);
  await expect(transport.fetchQuery!('viewer', new Set(['name']))).rejects.toMatchObject({
    errors,
    status: 403,
  });
});

test('isolates aliased operation errors while accepting a legitimate null sibling', async () => {
  const transport = transportWith({ data: { f1: { id: 'User-1' }, f2: null }, errors });
  const results = await Promise.allSettled([
    transport.fetchQuery!('viewer', new Set(['name'])),
    transport.fetchQuery!('viewer', new Set(['id'])),
  ]);
  expect(results[0]).toMatchObject({ reason: { errors }, status: 'rejected' });
  expect(results[1]).toEqual({ status: 'fulfilled', value: null });
});

test.each([null, undefined, [], false, 'invalid'].map((data) => ({ data })))(
  'rejects every query when response data is $data instead of reporting missing aliases as successful',
  async ({ data }) => {
    const transport = transportWith({ data, errors });
    const results = await Promise.allSettled([
      transport.fetchQuery!('viewer', new Set(['name'])),
      transport.fetchQuery!('viewer', new Set(['id'])),
    ]);
    for (const result of results) {
      expect(result).toMatchObject({ reason: { data, errors }, status: 'rejected' });
    }
  },
);

test('rejects a missing alias without discarding a successful nullable sibling', async () => {
  const transport = transportWith({ data: { f1: null } });
  const results = await Promise.allSettled([
    transport.fetchQuery!('viewer', new Set(['name'])),
    transport.fetchQuery!('viewer', new Set(['id'])),
  ]);
  expect(results[0]).toEqual({ status: 'fulfilled', value: null });
  expect(results[1]).toMatchObject({
    reason: { name: 'GraphQLRequestError', status: 200 },
    status: 'rejected',
  });
});

test.each([0, 1])(
  'isolates non-null mutation failure %s without skipping or losing another mutation',
  async (failingIndex) => {
    const schema = buildSchema(`
      type Query { available: Boolean }
      type User { id: ID! name: String! }
      type Mutation { rename(name: String!): User! }
    `);
    const rename = vi.fn(({ name }: { name: string }) => {
      if (name === `name-${failingIndex}`) {
        throw new Error('invalid-name');
      }
      return { id: 'User-1', name };
    });
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const { query, variables } = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify(
          await graphql({
            rootValue: { rename },
            schema,
            source: query,
            variableValues: variables,
          }),
        ),
      );
    });
    const transport = createGraphQLTransport<{
      rename: { input: { name: string }; output: { id: string; name: string } };
    }>({
      fetch,
      live: false,
      mutations: { rename: { entity: 'User', field: 'rename', inputArg: false } },
      schema: createGraphQLArgumentSchema(schema),
      types: [{ type: 'User' }],
      url: '/graphql',
    });
    const results = await Promise.allSettled(
      [0, 1].map((index) =>
        transport.mutate!('rename', { name: `name-${index}` }, new Set(['name'])),
      ),
    );
    expect(results[failingIndex]).toMatchObject({
      reason: { message: 'invalid-name', name: 'GraphQLRequestError' },
      status: 'rejected',
    });
    expect(results[1 - failingIndex]).toMatchObject({
      status: 'fulfilled',
      value: { id: '1', name: `name-${1 - failingIndex}` },
    });
    expect(rename.mock.calls.map(([input]) => input.name)).toEqual(['name-0', 'name-1']);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls) {
      const { query } = JSON.parse(String(init?.body));
      const operation = parse(query).definitions[0];
      expect(operation.kind).toBe('OperationDefinition');
      if (operation.kind === 'OperationDefinition') {
        expect(operation.selectionSet.selections).toHaveLength(1);
      }
    }
  },
);
