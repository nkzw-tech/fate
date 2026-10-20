import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildSchema, graphql } from 'graphql';
import { createServer } from 'vite';
import { expect, test } from 'vite-plus/test';
import { fate } from '../vite.ts';

const setExampleEnv = () => {
  process.env.BETTER_AUTH_SECRET ??= 'test-secret-with-enough-entropy-for-better-auth';
  process.env.BETTER_AUTH_URL ??= 'http://localhost:9020';
  process.env.CLIENT_DOMAIN ??= 'http://localhost:6001';
  process.env.DATABASE_URL ??= 'postgresql://fate:echo@localhost:5432/fate';
  process.env.VITE_SERVER_URL ??= 'http://localhost:9020';
};

const resolveId = (id: string, clientModule?: '@nkzw/fate' | 'react-fate') => {
  const plugin = fate({
    clientModule,
    module: './server.ts',
  });

  return (plugin.resolveId as (id: string) => string | undefined)(id);
};

const getSsrNoExternal = (clientModule?: '@nkzw/fate' | 'react-fate') => {
  const plugin = fate({
    clientModule,
    module: './server.ts',
  });

  return (plugin.config as () => { ssr?: { noExternal?: Array<string> } })().ssr?.noExternal;
};

test('resolves the core client entry to the generated Vite module', () => {
  expect(resolveId('@nkzw/fate/client')).toBe('\0@nkzw/fate/client.ts');
  expect(resolveId('react-fate/client')).toBeUndefined();
});

test('resolves the React client entry to the generated Vite module', () => {
  expect(resolveId('react-fate/client', 'react-fate')).toBe('\0@nkzw/fate/client.ts');
  expect(resolveId('@nkzw/fate/client', 'react-fate')).toBe('\0@nkzw/fate/client.ts');
});

test('runs before Vite resolves package exports', () => {
  expect(
    fate({
      clientModule: 'react-fate',
      module: './server.ts',
    }).enforce,
  ).toBe('pre');
});

test('keeps the generated client runtime inside Vite during SSR', () => {
  expect(getSsrNoExternal()).toEqual(['@nkzw/fate']);
  expect(getSsrNoExternal('react-fate')).toEqual(['@nkzw/fate', 'react-fate']);
});

test('serves the generated client as JavaScript', async () => {
  setExampleEnv();

  const server = await createServer({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      fate({
        clientModule: 'react-fate',
        generatedFile: false,
        module: '@nkzw/fate-server/src/trpc/router.ts',
        tsconfigFile: false,
      }),
    ],
    resolve: { conditions: ['@nkzw/source'] },
    root: path.resolve(import.meta.dirname, '../../../../example/client'),
    server: { middlewareMode: true },
  });

  try {
    const resolved = await server.pluginContainer.resolveId('react-fate/client');
    expect(resolved?.id).toBe('\0@nkzw/fate/client.ts');

    const loaded = await server.pluginContainer.load(resolved!.id);
    const code = typeof loaded === 'string' ? loaded : loaded?.code;

    expect(code).toContain('export const createFateClient');
    expect(code).not.toContain('import type');
    expect(code).not.toContain('declare module');
    expect(code).not.toContain('type RouterInputs');
  } finally {
    await server.close();
  }
});

test('serves the Void generated client with a root-resolved server runtime import', async () => {
  setExampleEnv();

  const server = await createServer({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      fate({
        clientModule: 'react-fate',
        generatedFile: false,
        module: './src/fate/server.ts',
        transport: 'void',
        tsconfigFile: false,
      }),
    ],
    resolve: { conditions: ['@nkzw/source'] },
    root: path.resolve(import.meta.dirname, '../../../../example/void'),
    server: { middlewareMode: true },
  });

  try {
    const resolved = await server.pluginContainer.resolveId('react-fate/client');
    expect(resolved?.id).toBe('\0@nkzw/fate/client.ts');

    const loaded = await server.pluginContainer.load(resolved!.id);
    const code = typeof loaded === 'string' ? loaded : loaded?.code;

    expect(code).toMatch(/import\(["']\/src\/fate\/server\.ts["']\)/);
    expect(code).not.toMatch(/import\(["']\.\/src\/fate\/server\.ts["']\)/);
  } finally {
    await server.close();
  }
});

test('bootstraps GraphQL schema types imported by the mapping module on a clean checkout', async () => {
  const root = await mkdtemp(path.join(process.cwd(), 'node_modules/.fate-schema-'));
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    await writeFile(
      path.join(root, 'graphql.ts'),
      `
      import type { GraphQLEntities } from './.fate/schema.generated.ts';
      export type User = GraphQLEntities['User'];
      export const userDataView = { typeName: 'User', fields: { id: true, username: true } };
      export const Root = { viewer: userDataView };
      export const fateGraphQL = { schema: 'type Query { viewer: User! } type User { id: ID!, username: String! }' };
    `,
    );
    server = await createServer({
      configFile: false,
      logLevel: 'silent',
      plugins: [fate({ module: './graphql.ts', transport: 'graphql' })],
      root,
      server: { middlewareMode: true },
    });
    const resolved = await server.pluginContainer.resolveId('@nkzw/fate/client');
    const loaded = await server.pluginContainer.load(resolved!.id);
    const code = typeof loaded === 'string' ? loaded : loaded?.code;
    expect(await readFile(path.join(root, '.fate/schema.generated.ts'), 'utf8')).toContain(
      'export type GraphQLEntities',
    );
    expect(await readFile(path.join(root, '.fate/client.generated.ts'), 'utf8')).toContain(
      'type User = GraphQLEntities["User"]',
    );
    expect(code).not.toContain('GraphQLEntities');
    expect(code).not.toContain('buildSchema');
  } finally {
    await server?.close();
    await rm(root, { force: true, recursive: true });
  }
});

test('generated GraphQL clients refetch by username through configured query roots', async () => {
  const root = await mkdtemp(path.join(process.cwd(), 'node_modules/.fate-refetch-'));
  const sdl =
    'type Query { viewer: User, user(username: String!): User } type User { id: ID!, username: String!, bio: String! }';
  const schema = buildSchema(sdl);
  const user = { bio: 'Biography', id: 'User-1', username: 'cpojer' };
  const queries: Array<string> = [];
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    await writeFile(
      path.join(root, 'graphql.ts'),
      `
      export const fateGraphQL = ${JSON.stringify({
        nodes: false,
        refetch: { User: { args: { username: { field: 'username' } }, root: 'user' } },
        roots: { user: { type: 'User' }, viewer: { type: 'User' } },
        schema: sdl,
      })};
    `,
    );
    server = await createServer({
      configFile: false,
      logLevel: 'silent',
      plugins: [fate({ module: './graphql.ts', transport: 'graphql' })],
      resolve: {
        alias: [
          { find: /^@nkzw\/fate$/, replacement: path.resolve(import.meta.dirname, '../index.ts') },
        ],
      },
      root,
      server: { middlewareMode: true },
    });
    const runtime = await server.ssrLoadModule('@nkzw/fate');
    const generated = await server.ssrLoadModule('@nkzw/fate/client');
    const client = generated.createFateClient({
      fetch: async (_url: string, init: RequestInit) => {
        const { query, variables } = JSON.parse(init.body as string);
        queries.push(query);
        return new Response(
          JSON.stringify(
            await graphql({
              rootValue: {
                user: ({ username }: { username: string }) =>
                  username === user.username ? user : null,
                viewer: () => user,
              },
              schema,
              source: query,
              variableValues: variables,
            }),
          ),
        );
      },
      live: false,
      url: '/graphql',
    });
    const Identity = runtime.view()({ id: true });
    const Profile = runtime.view()({ bio: true });
    await client.request({ viewer: { view: Identity } });
    expect(client.store.read('User:1')).toHaveProperty('username', 'cpojer');
    await client.request({ user: { id: '1', view: Profile } });
    expect(client.store.read('User:1')).toHaveProperty('bio', 'Biography');
    expect(queries).toHaveLength(2);
    expect(queries[1]).toContain('user(');
    expect(queries[1]).not.toContain('nodes(');
  } finally {
    await server?.close();
    await rm(root, { force: true, recursive: true });
  }
});

test('generates and executes the schema-driven GraphQL client template', async () => {
  const root = await mkdtemp(path.join(process.cwd(), 'node_modules/.fate-graphql-template-'));
  const template = path.resolve(
    import.meta.dirname,
    '../../../create-fate/templates/fate/graphql-client/src/fate',
  );
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    await mkdir(path.join(root, 'src/fate'), { recursive: true });
    await cp(template, path.join(root, 'src/fate'), { recursive: true });
    const schema = buildSchema(await readFile(path.join(template, 'schema.graphql'), 'utf8'));
    server = await createServer({
      configFile: false,
      logLevel: 'silent',
      plugins: [fate({ module: './src/fate/graphql.ts', transport: 'graphql' })],
      resolve: {
        alias: [
          { find: /^@nkzw\/fate$/, replacement: path.resolve(import.meta.dirname, '../index.ts') },
        ],
      },
      root,
      server: { middlewareMode: true },
    });
    const runtime = await server.ssrLoadModule('@nkzw/fate');
    const generated = await server.ssrLoadModule('@nkzw/fate/client');
    const post = {
      author: { id: 'User-1', name: 'Ada', username: 'ada' },
      id: 'Post-1',
      title: 'First',
    };
    const client = generated.createFateClient({
      fetch: async (_url: string, init: RequestInit) => {
        const { query, variables } = JSON.parse(init.body as string);
        const result = await graphql({
          rootValue: {
            postLike: ({ input }: { input: { id: string } }) => {
              expect(input.id).toBe('Post-1');
              return { ...post, title: 'Liked' };
            },
            posts: ({ first }: { first: number }) => {
              expect(first).toBe(10);
              return {
                edges: [{ cursor: 'first', node: post }],
                pageInfo: {
                  endCursor: 'first',
                  hasNextPage: false,
                  hasPreviousPage: false,
                  startCursor: 'first',
                },
              };
            },
            viewer: () => post.author,
          },
          schema,
          source: query,
          variableValues: variables,
        });
        expect(result.errors).toBeUndefined();
        return new Response(JSON.stringify(result));
      },
      live: false,
      url: '/graphql',
    });
    const UserView = runtime.view()({ name: true });
    const PostView = runtime.view()({ author: UserView, title: true });
    const result = await client.request({
      posts: { args: { first: 10 }, list: PostView },
      viewer: { view: UserView },
    });
    expect(result.posts).toHaveLength(1);
    expect((await client.readView(PostView, result.posts[0])).data.title).toBe('First');
    const liked = await client.mutations.post.like({ input: { id: 'Post-1' }, view: PostView });
    expect(liked).toMatchObject({ error: undefined, result: { id: '1', title: 'Liked' } });
    expect((await client.readView(PostView, result.posts[0])).data.title).toBe('Liked');
    const source = await readFile(path.join(root, '.fate/client.generated.ts'), 'utf8');
    expect(source).not.toContain('readFileSync');
    expect(source).not.toMatch(/import[^;]*src\/fate\/graphql\.ts/);
    expect(await readFile(path.join(root, '.fate/schema.generated.ts'), 'utf8')).toContain(
      'GraphQLEntities',
    );
  } finally {
    await server?.close();
    await rm(root, { force: true, recursive: true });
  }
});

test.each(['react-fate', 'vue-fate'] as const)(
  'executes generated value roots and mutations through %s exports',
  async (clientModule) => {
    const root = await mkdtemp(path.join(process.cwd(), 'node_modules/.fate-value-'));
    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
      await writeFile(
        path.join(root, 'graphql.ts'),
        `export const fateGraphQL = {
        schema: 'type Query { prices: Price! } type Price { amount: Int! } type Mutation { end: Boolean! }',
        roots: { prices: { embedded: true, type: 'Price' } },
        mutations: { end: { entity: '__value__', field: 'end', inputArg: false } },
      };`,
      );
      server = await createServer({
        configFile: false,
        logLevel: 'silent',
        plugins: [fate({ clientModule, module: './graphql.ts', transport: 'graphql' })],
        resolve: {
          alias: [
            {
              find: new RegExp(`^${clientModule}$`),
              replacement: path.resolve(
                import.meta.dirname,
                '../../../',
                clientModule,
                clientModule === 'react-fate' ? 'src/index.tsx' : 'src/index.ts',
              ),
            },
            {
              find: /^@nkzw\/fate$/,
              replacement: path.resolve(import.meta.dirname, '../index.ts'),
            },
          ],
        },
        root,
        server: { middlewareMode: true },
      });
      const generated = await server.ssrLoadModule(`${clientModule}/client`);
      const client = generated.createFateClient({
        fetch: async (_url: string, init: RequestInit) => {
          const mutation = JSON.parse(init.body as string).query.startsWith('mutation');
          return new Response(
            JSON.stringify({
              data: { [mutation ? 'f2' : 'f1']: mutation ? false : { amount: 7 } },
            }),
          );
        },
        live: false,
        url: '/graphql',
      });
      expect(await client.request({ prices: { value: { amount: true } } })).toEqual({
        prices: { amount: 7 },
      });
      expect(await client.mutations.end({ input: {} })).toEqual({
        error: undefined,
        result: false,
      });
    } finally {
      await server?.close();
      await rm(root, { force: true, recursive: true });
    }
  },
);
