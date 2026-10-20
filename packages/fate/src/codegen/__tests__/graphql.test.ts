import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildSchema } from 'graphql';
import { expect, test } from 'vite-plus/test';
import { graphqlMutation } from '../../graphqlTransport.ts';
import { dataView } from '../../server/dataView.ts';
import { createClientSource } from '../client.ts';
import { createGraphQLArgumentSchema, createGraphQLSchemaSource } from '../graphql.ts';

const execFileAsync = promisify(execFile);
const schema = `
  schema { query: Read, mutation: Write }
  enum Biome { Grassland Desert }
  input Filter { biome: Biome!, limit: Int! = 5, next: Filter, biomes: [Biome!] }
  scalar JSON
  type Image { url: String!, width: Int }
  interface Node { id: ID! }
  type MapEdge { cursor: String, node: Map }
  type PageInfo { hasNextPage: Boolean!, hasPreviousPage: Boolean!, endCursor: String, startCursor: String }
  type MapConnection { edges: [MapEdge], pageInfo: PageInfo! }
  type Map implements Node { related: MapConnection, id: ID!, name: String!, image: Image, json: JSON, state(biome: Biome!): String! }
  union Result = Map | Image
  type Price { amount: Int! }
  type Receipt { code: String! }
  type Read { prices: Price!, map(filter: Filter!): Map, optionalMap(biome: Biome): Map, viewer: Map }
  type Write { end: Boolean!, receipt: Receipt!, edit(input: Filter!): Map, rename(id: ID!, name: String!): Map }
`;
type MapEntity = { __typename: 'Map'; id: string; name: string; state: string };
const mapDataView = dataView<MapEntity>('Map')({ id: true, name: true, state: true });
const moduleExports = {
  fateGraphQL: {
    mutations: {
      edit: graphqlMutation<MapEntity, unknown, MapEntity>('Map', { field: 'edit' }),
      end: { entity: '__value__', field: 'end', inputArg: false },
      receipt: { entity: '__value__', field: 'receipt', inputArg: false, type: 'Receipt' },
      rename: graphqlMutation<MapEntity, unknown, MapEntity>('Map', {
        field: 'rename',
        inputArg: false,
      }),
    },
    roots: { prices: { embedded: true, type: 'Price' }, selectedMap: { field: 'map' } },
    schema,
  },
  mapDataView,
  Root: { optionalMap: mapDataView, selectedMap: mapDataView, viewer: mapDataView },
};

const generate = (fateGraphQL: object) =>
  createClientSource({
    moduleExports: { ...moduleExports, fateGraphQL },
    moduleName: './contract.ts',
    transport: 'graphql',
  });

test('extracts input defaults and custom root names from SDL and schema objects', () => {
  const metadata = createGraphQLArgumentSchema(schema);
  expect(metadata).toEqual(createGraphQLArgumentSchema(buildSchema(schema)));
  expect(metadata).toMatchObject({
    inputs: {
      Filter: { fields: { limit: { hasDefault: true, type: 'Int!' }, next: { type: 'Filter' } } },
    },
    mutationType: 'Write',
    queryType: 'Read',
  });
  expect(metadata.fields.Read.map.filter.type).toBe('Filter!');
});

test('generates concrete identity metadata for GraphQL interface relations', () => {
  const source = createClientSource({
    moduleExports: {
      ...moduleExports,
      fateGraphQL: {
        ...moduleExports.fateGraphQL,
        schema: schema.replace(
          'type Map implements Node {',
          'type Map implements Node { owner: Node,',
        ),
      },
    },
    moduleName: './contract.ts',
    transport: 'graphql',
  });
  expect(source).toContain('owner: { type: \'Node\', possibleTypes: ["Map"] }');
  expect(source).toContain('possibleTypes: ["Map"]');
  expect(source).toContain("type: 'Node'");
});

test('explains undeclared SDL directives without relaxing schema validation', () => {
  const annotatedSDL = `
    type Query @fetchable(field_name: "id") {
      viewer: String @auth(role: "User")
    }
  `;
  expect(() => createGraphQLArgumentSchema(annotatedSDL)).toThrow(
    /SDL uses undeclared directives @fetchable, @auth.*Declare them.*assumeValidSDL/,
  );
  expect(
    createGraphQLArgumentSchema(buildSchema(annotatedSDL, { assumeValidSDL: true })).queryType,
  ).toBe('Query');
  expect(() => createGraphQLArgumentSchema('type Query { viewer: Missing }')).toThrow(
    /Unknown type "Missing"/,
  );
});

test('rejects schema mappings with unknown fields or mutation inputs during generation', () => {
  expect(() =>
    generate({ ...moduleExports.fateGraphQL, roots: { selectedMap: { field: 'typo' } } }),
  ).toThrow(/Unknown query field/);
  expect(() =>
    generate({
      ...moduleExports.fateGraphQL,
      mutations: { edit: { entity: 'Map', field: 'edit', inputArg: 'typo' } },
    }),
  ).toThrow(/Unknown input argument/);
  expect(() =>
    createClientSource({
      moduleExports: {
        ...moduleExports,
        typo: dataView<{ wrong: string }>('Map')({ wrong: true }),
      },
      moduleName: './contract.ts',
      transport: 'graphql',
    }),
  ).toThrow(/Map.wrong/);
});

test.each(['@nkzw/fate', 'react-fate', 'vue-fate'] as const)(
  'generates argument contracts enforced by %s',
  async (clientModule) => {
    const root = process.cwd();
    const directory = await mkdtemp(path.join(root, 'node_modules/.fate-graphql-'));
    try {
      const source = createClientSource({
        clientModule,
        moduleExports,
        moduleName: './contract.ts',
        transport: 'graphql',
      });
      expect(source).toContain('schema: graphQL.schema');
      expect(source).not.toContain('buildSchema');
      await writeFile(path.join(directory, 'client.ts'), source);
      await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
      await writeFile(
        path.join(directory, 'contract.ts'),
        `
      import type { GraphQLMutationDefinition } from '@nkzw/fate';
      export type Map = { __typename: 'Map'; id: string; name: string; state: string };
      export declare const fateGraphQL: { mutations: {
        edit: GraphQLMutationDefinition<Map, unknown, Map>;
        rename: GraphQLMutationDefinition<Map, unknown, Map>;
      } };
    `,
      );
      await writeFile(
        path.join(directory, 'usage.ts'),
        `
      import '${clientModule}/client';
      import { view, type ViewData, type RefetchArguments } from '@nkzw/fate';
      import type { GraphQLEntities, GraphQLTypes } from './client.ts';
      type Map = GraphQLEntities['Map'];
      import { createFateClient, type GraphQLFieldArguments } from './client.ts';
      const client = createFateClient({ url: '/graphql' });
      client.request({ prices: { value: { amount: true } } });
      client.mutations.end({ input: {} });
      client.mutations.receipt({ input: {}, select: { code: true } });
      const projection = { filter: { object: { biome: { value: 'Grassland' } } } } satisfies RefetchArguments<Map, GraphQLFieldArguments['Read']['map']>;
      void projection;
      // @ts-expect-error Projection fields must have compatible GraphQL argument types.
      const badProjection = { filter: { object: { biome: { field: 'name' } } } } satisfies RefetchArguments<Map, GraphQLFieldArguments['Read']['map']>;
      void badProjection;
      const MapView = view<Map>()({ name: true });
      const ImageView = view<Map>()({ image: { url: true } });
      const RelatedView = view<Map>()({ related: { items: { node: { name: true } } } });
      void ImageView;
      // @ts-expect-error Generated entities reject fields absent from GraphQL.
      view<Map>()({ absent: true });
      const union = null as unknown as GraphQLTypes['Result'];
      if (union.__typename === 'Image') {
        const url: string = union.url;
        void url;
        // @ts-expect-error Discriminated unions retain concrete schema fields.
        union.name;
      }
      const custom = null as unknown as Map['json'];
      // @ts-expect-error Unmapped custom scalars are unknown.
      const json: string = custom;
      void json;
      ${
        clientModule === '@nkzw/fate'
          ? ''
          : `
      import { useRequest } from '${clientModule}';
      ${
        clientModule === 'react-fate'
          ? `import { useRefetch } from 'react-fate';
        const refetch = useRefetch({ selectedMap: { args: { filter: { biome: 'Grassland' } }, view: MapView } });
        void refetch();
        // @ts-expect-error Refetch requires schema arguments too.
        useRefetch({ selectedMap: { view: MapView } });
        // @ts-expect-error Refetch validates enum arguments.
        useRefetch({ selectedMap: { args: { filter: { biome: 'Lava' } }, view: MapView } });
        import { useActionState } from 'react'; const [state, dispatch] = useActionState(client.actions.edit, null); dispatch({ input: { biome: 'Grassland' }, view: MapView }); void state;`
          : ''
      }
      useRequest({ selectedMap: { args: { filter: { biome: 'Grassland' } }, view: MapView } });
      // @ts-expect-error Adapter enforces required root arguments.
      useRequest({ selectedMap: { view: MapView } });
      // @ts-expect-error Adapter enforces enum values.
      useRequest({ selectedMap: { args: { filter: { biome: 'Lava' } }, view: MapView } });
      `
      }

      client.request({ selectedMap: { args: { filter: { biome: 'Grassland' } }, view: MapView } });
      client.request({ selectedMap: { args: { filter: { biome: 'Desert', biomes: ['Grassland'], next: null } }, view: MapView } });
      client.request({ viewer: { args: { state: { biome: 'Desert' } }, view: MapView } });
      client.request({ viewer: { view: MapView } });
      client.request({ optionalMap: { view: MapView } });
      client.request({ optionalMap: { args: { biome: 'Grassland' }, view: MapView } });
      // @ts-expect-error Optional arguments still enforce their types.
      client.request({ optionalMap: { args: { biome: 'Lava' }, view: MapView } });
      // @ts-expect-error Root without arguments does not accept arbitrary keys.
      client.request({ viewer: { args: { typo: true }, view: MapView } });
      const edited = await client.mutations.edit({ input: { biome: 'Grassland' }, view: MapView });
      if (!edited.error && edited.result) {
        const name: string = edited.result.name;
        const id: string = edited.result.id;
        void [name, id];
        // @ts-expect-error Fields not selected are not promised in mutation results.
        edited.result.state;
        // @ts-expect-error Raw mutation results are not masked ViewData with view tags.
        const masked: ViewData<Map, { name: true }> = edited.result;
        void masked;
      }
      const unselected = await client.mutations.edit({ input: { biome: 'Grassland' } });
      if (!unselected.error && unselected.result) {
        // @ts-expect-error No view means only automatic entity identity is promised.
        unselected.result.name;
      }
      const related = await client.mutations.edit({ input: { biome: 'Grassland' }, view: RelatedView });
      if (!related.error && related.result?.related) {
        const name: string = related.result.related.items[0].node.name;
        void name;
        // @ts-expect-error Nested mutation results also respect selections.
        related.result.related.items[0].node.state;
      }
      const nullable: typeof edited.result = null;
      void nullable;
      client.mutations.edit({ input: { biome: 'Grassland' } });
      client.mutations.rename({ input: { id: 'Map-1', name: 'New' } });
      const nested = { biome: 'Grassland' } satisfies GraphQLFieldArguments['Map']['state'];
      void nested;
      // @ts-expect-error Required root argument.
      client.request({ selectedMap: { view: MapView } });
      // @ts-expect-error Unknown enum value.
      client.request({ selectedMap: { args: { filter: { biome: 'Lava' } }, view: MapView } });
      // @ts-expect-error Unknown root argument.
      client.request({ selectedMap: { args: { filter: { biome: 'Grassland' }, typo: true }, view: MapView } });
      // @ts-expect-error Non-null input even when defaulted.
      client.mutations.edit({ input: { biome: 'Grassland', limit: null } });
      // @ts-expect-error Unknown mutation arguments are rejected.
      client.mutations.rename({ input: { id: 'Map-1', name: 'Name', typo: true } });
      // @ts-expect-error Required input-object field.
      client.mutations.edit({ input: {} });
      // @ts-expect-error Mutation arguments come from the schema, not the manual unknown input.
      client.mutations.rename({ input: { id: 'Map-1' } });
      // @ts-expect-error Nested enum input.
      client.mutations.edit({ input: { biome: 'Grassland', biomes: ['Lava'] } });
      // @ts-expect-error Field argument enum.
      const bad = { biome: 'Lava' } satisfies GraphQLFieldArguments['Map']['state'];
      void bad;
    `,
      );
      await writeFile(
        path.join(directory, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            allowImportingTsExtensions: true,
            jsx: 'react-jsx',
            module: 'nodenext',
            noEmit: true,
            noUnusedLocals: true,
            paths: {
              '@nkzw/fate': [path.join(root, 'packages/fate/src/index.ts')],
              '@nkzw/fate/client': [path.join(root, 'packages/fate/lib/clientStub.d.mts')],
              react: [path.join(root, 'packages/react-fate/node_modules/@types/react/index.d.ts')],
              'react-fate': [path.join(root, 'packages/react-fate/src/index.tsx')],
              'react-fate/client': [path.join(root, 'packages/react-fate/lib/client.d.mts')],
              'vue-fate': [path.join(root, 'packages/vue-fate/src/index.ts')],
              'vue-fate/client': [path.join(root, 'packages/vue-fate/lib/client.d.mts')],
            },
            skipLibCheck: true,
            strict: true,
            target: 'esnext',
            types: ['vite/client'],
          },
          include: ['./*.ts'],
        }),
      );
      const result = await execFileAsync(process.execPath, [
        path.join(root, 'node_modules/typescript/bin/tsc'),
        '-p',
        path.join(directory, 'tsconfig.json'),
      ]).catch((error: Error & { stdout: string }) => {
        throw new Error(error.stdout || error.message, { cause: error });
      });
      expect(result.stdout).toBe('');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  },
);

test('generates schema output contracts without handwritten application types', () => {
  const source = createGraphQLSchemaSource(
    `
    scalar Timestamp
    enum Role { Admin Player }
    interface Node { id: ID! }
    type User implements Node { id: ID!, username: String!, role: Role!, createdAt: Timestamp!, matrix: [[Int!]!]!, friends: [User], image: Image }
    type Image { url: String! }
    union SearchResult = User | Image
    type Query { viewer: User!, search: [SearchResult!]! }
  `,
    { Timestamp: { input: 'string', output: 'number' } },
  );
  expect(source).toContain('export type GraphQLTypes =');
  expect(source).toContain('readonly "username": string;');
  expect(source).toContain('readonly "createdAt": number;');
  expect(source).toContain('readonly "matrix": Array<Array<number>>;');
  expect(source).toContain(
    'readonly "SearchResult": GraphQLTypes["User"] | GraphQLTypes["Image"];',
  );
  expect(source).toContain('readonly "Node": GraphQLTypes["User"];');
  expect(source).toContain('readonly "friends": Array<GraphQLTypes["User"] | null> | null;');
  expect(source).not.toContain("from 'graphql'");
});

test('derives mutation output nullability from the schema instead of its manual declaration', () => {
  const source = generate(moduleExports.fateGraphQL);
  expect(source).toContain('GraphQLSelectedResult<GraphQLResponses["Write"]["edit"]>');
  expect(source).not.toContain("GraphQLMutationOutput<typeof fateGraphQL.mutations['edit']>");
});

test('rejects output mappings that disagree with the GraphQL schema', () => {
  expect(() =>
    generate({
      ...moduleExports.fateGraphQL,
      mutations: { edit: { entity: 'Image', field: 'edit' } },
    }),
  ).toThrow(/returns 'Map', not 'Image'/);
  expect(() =>
    generate({
      ...moduleExports.fateGraphQL,
      roots: { ...moduleExports.fateGraphQL.roots, viewer: { type: 'Image' } },
    }),
  ).toThrow(/returns 'Map', not 'Image'/);
});

const refetchSchema = `
  input Lookup { username: String!, tenant: Int! }
  type User { id: ID!, username: String!, count: Int!, optional: String }
  type Query { user(username: String!): User, lookup(input: Lookup!): User, users: [User!]! }
`;
const refetchSource = (refetch: unknown) =>
  createClientSource({
    moduleExports: {
      fateGraphQL: {
        nodes: false,
        refetch: { User: refetch },
        roots: { lookup: { type: 'User' }, profile: { field: 'user', type: 'User' } },
        schema: refetchSchema,
      },
    },
    moduleName: './contract.ts',
    transport: 'graphql',
  });

test('generates query-based refetch recipes using ordinary roots without data views', () => {
  const source = refetchSource({ args: { username: { field: 'username' } }, root: 'profile' });
  expect(source).toContain('refetch: {"args":{"username":{"field":"username"}},"root":"profile"}');
  expect(source).toContain("'profile': clientRoot<User | null");
  expect(source).toContain('"nodes": false');
});

test('supports nested refetch input projections checked against the schema', () => {
  expect(() =>
    refetchSource({
      args: { input: { object: { tenant: { value: 7 }, username: { field: 'username' } } } },
      root: 'lookup',
    }),
  ).not.toThrow();
});

test.each([
  [{ args: { username: { field: 'missing' } }, root: 'profile' }, /incompatible/],
  [{ args: { username: { field: 'count' } }, root: 'profile' }, /incompatible/],
  [{ args: { username: { field: 'optional' } }, root: 'profile' }, /incompatible/],
  [{ args: {}, root: 'profile' }, /Missing refetch argument/],
  [
    { args: { username: { field: 'username' }, wrong: { value: 1 } }, root: 'profile' },
    /Unknown refetch argument/,
  ],
  [
    { args: { input: { object: { username: { field: 'username' } } } }, root: 'lookup' },
    /Missing refetch argument/,
  ],
  [
    {
      args: { input: { object: { tenant: { value: 'wrong' }, username: { field: 'username' } } } },
      root: 'lookup',
    },
    /Invalid input/,
  ],
  [{ args: { username: { field: 'username' } }, root: 'missing' }, /must be a query/],
])('rejects invalid refetch recipe %j', (refetch, error) => {
  expect(() => refetchSource(refetch)).toThrow(error);
});
