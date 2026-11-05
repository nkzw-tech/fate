import { DatabaseSync } from 'node:sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { expect, test } from 'vite-plus/test';
import { dataView } from '../dataView.ts';
import { createDrizzleSourceAdapter } from '../drizzle.ts';

for (const direction of ['asc', 'desc'] as const) {
  test(`nullable order columns do not truncate ${direction} pagination`, async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(
      "CREATE TABLE Post (id TEXT PRIMARY KEY, rank INTEGER); INSERT INTO Post VALUES ('1', NULL), ('2', NULL), ('3', 10);",
    );
    const db = drizzle(async (sql, params) => {
      const statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      return { rows: statement.all(...params) };
    });
    const table = sqliteTable('Post', { id: text('id').primaryKey(), rank: integer('rank') });
    const view = dataView<{ id: string; rank: number | null }>('Post')({ id: true, rank: true });
    const adapter = createDrizzleSourceAdapter({
      db,
      views: [{ orderBy: [{ direction, field: 'rank' }], table, view }],
    });
    try {
      const options = {
        ctx: {},
        direction: 'forward' as const,
        input: { select: ['id', 'rank'] },
        take: 2,
        view,
      };
      expect(await adapter.resolveConnection(options)).toEqual(
        direction === 'asc'
          ? [
              { id: '1', rank: null },
              { id: '2', rank: null },
            ]
          : [
              { id: '3', rank: 10 },
              { id: '1', rank: null },
            ],
      );
      expect(
        await adapter.resolveConnection({ ...options, cursor: direction === 'asc' ? '1' : '3' }),
      ).toEqual(
        direction === 'asc'
          ? [
              { id: '2', rank: null },
              { id: '3', rank: 10 },
            ]
          : [
              { id: '1', rank: null },
              { id: '2', rank: null },
            ],
      );
    } finally {
      sqlite.close();
    }
  });
}
