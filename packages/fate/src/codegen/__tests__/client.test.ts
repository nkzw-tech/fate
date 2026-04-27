import { expect, test } from 'vite-plus/test';
import { dataView, list } from '../../server/dataView.ts';
import { createSourceRegistry } from '../../server/executor.ts';
import { createFateServer } from '../../server/http.ts';
import { createLiveEventBus } from '../../server/live.ts';
import type { SourceDefinition } from '../../server/source.ts';
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

test('generates a native HTTP client source', () => {
  type Post = { id: string; title: string };
  const postDataView = dataView<Post>('Post')({
    id: true,
    title: true,
  });
  const source: SourceDefinition<Post> = { id: 'id', view: postDataView };
  const fate = createFateServer({
    mutations: {
      'post.like': {
        resolve: ({ input }: { input: { id: string } }) => ({
          id: input.id,
          title: 'Liked',
        }),
        type: 'Post',
      },
    },
    roots: {
      posts: list(postDataView),
    },
    sources: {
      getSource: <Item extends Record<string, unknown>>() =>
        source as unknown as SourceDefinition<Item>,
      registry: createSourceRegistry([[source, {}]]),
    },
  });

  const sourceText = createClientSource({
    moduleExports: {
      fate,
      postDataView,
      Root: { posts: list(postDataView) },
    },
    moduleName: '@org/server/http.ts',
    transport: 'native',
  });

  expect(sourceText).toContain('createHTTPTransport<FateAPI>');
  expect(sourceText).toContain('live: false');
  expect(sourceText).toContain('type FateAPI = InferFateAPI<typeof fateServer>;');
  expect(sourceText).toContain("'posts': clientRoot<FateAPI['lists']['posts']['output'], 'Post'>");
  expect(sourceText).toContain(
    "mutation<\n    Post,\n    FateAPI['mutations']['post.like']['input']",
  );
});

test('generates a native HTTP client source for fateServer exports', () => {
  type Post = { id: string; title: string };
  const postDataView = dataView<Post>('Post')({
    id: true,
    title: true,
  });
  const source: SourceDefinition<Post> = { id: 'id', view: postDataView };
  const fateServer = createFateServer({
    roots: {
      posts: list(postDataView),
    },
    sources: {
      getSource: <Item extends Record<string, unknown>>() =>
        source as unknown as SourceDefinition<Item>,
      registry: createSourceRegistry([[source, {}]]),
    },
  });

  const sourceText = createClientSource({
    moduleExports: {
      fateServer,
      postDataView,
      Root: { posts: list(postDataView) },
    },
    moduleName: '@org/server/http.ts',
    transport: 'native',
  });

  expect(sourceText).toContain("import type { fateServer, Post } from '@org/server/http.ts';");
  expect(sourceText).not.toContain('fate as fateServer');
});

test('generates a native HTTP client with live enabled when the server supports live', () => {
  type Post = { id: string; title: string };
  const postDataView = dataView<Post>('Post')({
    id: true,
    title: true,
  });
  const source: SourceDefinition<Post> = { id: 'id', view: postDataView };
  const fate = createFateServer({
    live: createLiveEventBus(),
    roots: {
      posts: list(postDataView),
    },
    sources: {
      getSource: <Item extends Record<string, unknown>>() =>
        source as unknown as SourceDefinition<Item>,
      registry: createSourceRegistry([[source, {}]]),
    },
  });

  const sourceText = createClientSource({
    moduleExports: {
      fate,
      postDataView,
      Root: { posts: list(postDataView) },
    },
    moduleName: '@org/server/http.ts',
    transport: 'native',
  });

  expect(sourceText).toContain('live: true');
});
