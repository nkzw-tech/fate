import { expect, test } from 'vite-plus/test';
import { createClientSource } from '../client.ts';

const importExampleModule = async <Module>(path: string) =>
  import(/* @vite-ignore */ new URL(path, import.meta.url).href) as Promise<Module>;

const setExampleEnv = () => {
  process.env.BETTER_AUTH_SECRET ??= 'test-secret-with-enough-entropy-for-better-auth';
  process.env.BETTER_AUTH_URL ??= 'http://localhost:9020';
  process.env.CLIENT_DOMAIN ??= 'http://localhost:6001';
  process.env.DATABASE_URL ??= 'postgresql://fate:echo@localhost:5432/fate';
  process.env.VITE_SERVER_URL ??= 'http://localhost:9020';
};

test('generates the same client source for the Prisma and Drizzle examples', async () => {
  setExampleEnv();

  const [prismaModule, drizzleModule] = await Promise.all([
    importExampleModule<Record<string, unknown>>(
      '../../../../../example/server-prisma/src/trpc/router.ts',
    ),
    importExampleModule<Record<string, unknown>>(
      '../../../../../example/server-drizzle/src/trpc/router.ts',
    ),
  ]);

  try {
    const moduleName = '@nkzw/fate-example-server';

    expect(createClientSource({ moduleExports: drizzleModule, moduleName })).toEqual(
      createClientSource({ moduleExports: prismaModule, moduleName }),
    );
  } finally {
    const [{ default: prisma }, { closeDatabase }] = await Promise.all([
      importExampleModule<{
        default: { $disconnect: () => Promise<void> };
      }>('../../../../../example/server-prisma/src/prisma/prisma.tsx'),
      importExampleModule<{
        closeDatabase: () => Promise<void>;
      }>('../../../../../example/server-drizzle/src/drizzle/db.ts'),
    ]);

    await Promise.all([prisma.$disconnect(), closeDatabase()]);
  }
});
