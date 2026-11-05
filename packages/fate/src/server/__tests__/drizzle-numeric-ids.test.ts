import { DatabaseSync } from 'node:sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { expect, test } from 'vite-plus/test';
import { dataView } from '../dataView.ts';
import { createDrizzleSourceAdapter } from '../drizzle.ts';

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
