import { DatabaseSync } from 'node:sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { expect, test } from 'vite-plus/test';
import type { FateProtocolResponse } from '../../protocol.ts';
import type { ConnectionResult } from '../connection.ts';
import { dataView, list } from '../dataView.ts';
import { createDrizzleSourceAdapter } from '../drizzle.ts';
import { createFateServer } from '../http.ts';

test('Drizzle resolves numeric primary keys', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    "CREATE TABLE Post (id INTEGER PRIMARY KEY, title TEXT); INSERT INTO Post VALUES (1, 'Hello');",
  );
  const db = drizzle(async (sql, params) => {
    const statement = sqlite.prepare(sql);
    statement.setReturnArrays(true);
    return { rows: statement.all(...params) };
  });
  const table = sqliteTable('Post', { id: integer('id').primaryKey(), title: text('title') });
  const view = dataView<{ id: number; title: string }>('Post')({ id: true, title: true });
  const adapter = createDrizzleSourceAdapter({ db, views: [{ table, view }] });
  try {
    expect(
      await adapter.resolveById({ ctx: {}, id: '1', input: { select: ['title'] }, view }),
    ).toEqual({ id: 1, title: 'Hello' });
  } finally {
    sqlite.close();
  }
});

test('native Drizzle lists can paginate using cursors from numeric primary keys', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE Post (id INTEGER PRIMARY KEY); INSERT INTO Post VALUES (1), (2);');
  try {
    const db = drizzle(async (sql, params) => {
      const statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      return { rows: statement.all(...params) };
    });
    const table = sqliteTable('Post', { id: integer('id').primaryKey() });
    const view = dataView<{ id: number }>('Post')({ id: true });
    const sources = createDrizzleSourceAdapter({ db, views: [{ table, view }] });
    const server = createFateServer({ roots: { posts: list(view) }, sources });
    const page = async (args: Record<string, unknown>) => {
      const response = await server.handleRequest(
        new Request('http://local/fate', {
          body: JSON.stringify({
            operations: [{ args, id: '1', kind: 'list', name: 'posts', select: ['id'] }],
            version: 1,
          }),
          method: 'POST',
        }),
      );
      return (await response.json()) as FateProtocolResponse;
    };

    const first = await page({ first: 1 });
    const result = first.results[0];
    if (!result?.ok) {
      throw new Error('The first page did not load.');
    }
    const cursor = (result.data as ConnectionResult<{ id: number }>).pagination.nextCursor;
    expect(await page({ after: cursor, first: 1 })).toMatchObject({
      results: [{ data: { items: [{ cursor: '2', node: { id: 2 } }] }, ok: true }],
    });
    expect(cursor).toBe('1');
  } finally {
    sqlite.close();
  }
});

test('nested Drizzle lists can paginate using cursors from numeric primary keys', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE Post (id TEXT PRIMARY KEY);
    CREATE TABLE Comment (id INTEGER PRIMARY KEY, postId TEXT);
    INSERT INTO Post VALUES ('post');
    INSERT INTO Comment VALUES (1, 'post'), (2, 'post');
  `);
  try {
    const db = drizzle(async (sql, params) => {
      const statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      return { rows: statement.all(...params) };
    });
    const posts = sqliteTable('Post', { id: text('id').primaryKey() });
    const comments = sqliteTable('Comment', {
      id: integer('id').primaryKey(),
      postId: text('postId'),
    });
    type Comment = { id: number; postId: string };
    const commentView = dataView<Comment>('Comment')({ id: true });
    const postView = dataView<{ comments: Array<Comment>; id: string }>('Post')({
      comments: list(commentView),
      id: true,
    });
    const adapter = createDrizzleSourceAdapter({
      db,
      views: [
        { table: comments, view: commentView },
        {
          relations: { comments: { foreignKey: 'postId', localKey: 'id' } },
          table: posts,
          view: postView,
        },
      ],
    });
    const page = async (args: Record<string, unknown>) =>
      (
        await adapter.resolveById({
          ctx: {},
          id: 'post',
          input: { args: { comments: args }, select: ['comments.id'] },
          view: postView,
        })
      )?.comments as ConnectionResult<Comment>;

    const first = await page({ first: 1 });
    const second = await page({ after: first.pagination.nextCursor, first: 1 });
    expect(second.items).toEqual([{ cursor: '2', node: { id: 2 } }]);
    expect(first.pagination.nextCursor).toBe('1');
  } finally {
    sqlite.close();
  }
});
