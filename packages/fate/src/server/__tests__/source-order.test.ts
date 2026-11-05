import { DatabaseSync } from 'node:sqlite';
import { initTRPC } from '@trpc/server';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { expect, test, vi } from 'vite-plus/test';
import { dataView, list } from '../dataView.ts';
import { createDrizzleFate, createDrizzleSourceAdapter } from '../drizzle.ts';
import { createPrismaFate, createPrismaSourceAdapter } from '../prisma.ts';

const Post = dataView<{ id: string; rank: number }>('Post')({ id: true, rank: true });
const views = {
  ascending: list(Post, { orderBy: { rank: 'asc' } }),
  descending: list(Post, { orderBy: { rank: 'desc' } }),
};
const { procedure } = initTRPC.create();
const input = { select: ['id'] };

test.each(['source adapter', 'tRPC helper'])(
  'Drizzle %s honors the requested list order',
  async (entryPoint) => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      sqlite.exec(`
      CREATE TABLE Post (id TEXT PRIMARY KEY, rank INTEGER);
      INSERT INTO Post VALUES ('a', 2), ('b', 1), ('c', 3);
    `);
      const db = drizzle(async (sql, params) => {
        const statement = sqlite.prepare(sql);
        statement.setReturnArrays(true);
        return { rows: statement.all(...params) };
      });
      const post = sqliteTable('Post', { id: text('id').primaryKey(), rank: integer('rank') });
      const options = { db, schema: { post }, views };
      const source =
        entryPoint === 'source adapter'
          ? createDrizzleSourceAdapter(options)
          : createDrizzleFate({ ...options, procedure });
      const rows = await source.resolveConnection({
        ctx: {},
        direction: 'forward',
        input,
        take: 2,
        view: views.descending,
      });
      expect(rows.map(({ id }) => id)).toEqual(['c', 'a']);
    } finally {
      sqlite.close();
    }
  },
);

test.each(['source adapter', 'tRPC helper'])(
  'Prisma %s honors the requested list order',
  async (entryPoint) => {
    const findMany = vi.fn(async () => [{ id: 'c' }]);
    const source =
      entryPoint === 'source adapter'
        ? createPrismaSourceAdapter({ views })
        : createPrismaFate({ procedure, views });
    await source.resolveConnection({
      ctx: { prisma: { post: { findMany } } },
      direction: 'forward',
      input,
      take: 2,
      view: views.descending,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ rank: 'desc' }, { id: 'asc' }] }),
    );
  },
);
