import { graphql } from 'graphql';
import { expect, test, vi } from 'vite-plus/test';
import { post } from '../server-drizzle/src/drizzle/schema.ts';
import { Root as DrizzleRoot } from '../server-drizzle/src/trpc/views.ts';
import schema from '../server-graphql/src/graphql/schema.tsx';
import { Root as PrismaRoot } from '../server-prisma/src/trpc/views.ts';

const posts = vi.hoisted(() =>
  Array.from({ length: 23 }, (_, index) => ({
    id: `post-${String(index + 1).padStart(2, '0')}`,
    title: 'Match',
  })),
);

vi.mock('graphql', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('graphql');
});

vi.mock('../server-graphql/src/lib/auth.tsx', () => ({ auth: {} }));

vi.mock('../server-graphql/src/prisma/prisma.tsx', () => ({
  default: {
    post: { findMany: async ({ take }: { take?: number }) => posts.slice(0, take) },
    user: { findMany: async () => [] },
  },
}));

test.each(['drizzle', 'prisma'] as const)('paginates beyond 20 matches with %s', async (kind) => {
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          orderBy: () => {
            const rows = table === post ? posts : [];
            return Object.assign(Promise.resolve(rows), {
              limit: async (size: number) => rows.slice(0, size),
            });
          },
        }),
      }),
    }),
  };
  const prisma = {
    post: { findMany: async ({ take }: { take?: number }) => posts.slice(0, take) },
    user: { findMany: async () => [] },
  };
  const { query } = kind === 'drizzle' ? DrizzleRoot.search.view : PrismaRoot.search.view;
  const result = await query({
    args: { query: 'Match' },
    ctx: { db, prisma } as never,
    cursor: 'Post:post-20',
    direction: 'forward',
    take: 3,
  });

  expect(result.map(({ id }) => id)).toEqual(['post-21', 'post-22', 'post-23']);
});

const querySearch = (after?: string) =>
  graphql({
    contextValue: { sessionUser: null },
    schema,
    source: `
      query Search($after: String) {
        search(query: "Match", first: 20, after: $after) {
          edges { node { ... on Post { title } } }
          pageInfo { endCursor hasNextPage }
        }
      }
    `,
    variableValues: { after },
  });

test('paginates beyond 20 matches with GraphQL', async () => {
  const first = await querySearch();
  expect(first.errors).toBeUndefined();
  const page = first.data?.search as { pageInfo: { endCursor: string; hasNextPage: boolean } };
  expect(page.pageInfo.hasNextPage).toBe(true);

  const next = await querySearch(page.pageInfo.endCursor);
  expect(next.errors).toBeUndefined();
  expect(next.data?.search).toMatchObject({
    edges: Array.from({ length: 3 }, () => ({ node: { title: 'Match' } })),
    pageInfo: { hasNextPage: false },
  });
});
