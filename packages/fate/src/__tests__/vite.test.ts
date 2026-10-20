import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
