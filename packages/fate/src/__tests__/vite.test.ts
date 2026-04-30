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
