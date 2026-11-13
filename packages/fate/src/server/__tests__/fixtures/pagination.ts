import { DatabaseSync } from 'node:sqlite';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { dataView, list } from '../../dataView.ts';
import { createDrizzleSourceAdapter } from '../../drizzle.ts';
import { createSourcePlan } from '../../source.ts';

export function paginationFixture(count = 100, latency = 0) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE Parent (id INTEGER PRIMARY KEY);
    CREATE TABLE Child (id INTEGER PRIMARY KEY, parentId INTEGER, rank INTEGER, __fate_parent TEXT, __fate_rank TEXT);
    CREATE TABLE Tag (id INTEGER PRIMARY KEY, rank INTEGER);
    CREATE TABLE ParentTag (parentId INTEGER, tagId INTEGER);
    CREATE INDEX Child_parent ON Child(parentId, rank, id);
    CREATE INDEX ParentTag_parent ON ParentTag(parentId, tagId);
  `);
  const insertParent = sqlite.prepare('INSERT INTO Parent VALUES (?)');
  const insertChild = sqlite.prepare('INSERT INTO Child VALUES (?, ?, ?, ?, ?)');
  const insertTag = sqlite.prepare('INSERT INTO Tag VALUES (?, ?)');
  const insertLink = sqlite.prepare('INSERT INTO ParentTag VALUES (?, ?)');
  for (let i = 1; i <= 8; i++) {
    insertTag.run(i, i < 3 ? null : Math.floor(i / 2));
  }
  for (let parent = 1; parent <= count; parent++) {
    insertParent.run(parent);
    // Include an empty parent and shared many-to-many children.
    if (parent === count) {
      continue;
    }
    for (let i = 1; i <= 8; i++) {
      insertChild.run(
        parent * 10 + i,
        parent,
        i < 3 ? null : Math.floor(i / 2),
        `user-${i}`,
        `rank-${i}`,
      );
      if (i >= (parent % 3) + 1) {
        insertLink.run(parent, i);
      }
    }
  }
  const parentTable = sqliteTable('Parent', { id: integer('id').primaryKey() });
  const childTable = sqliteTable('Child', {
    __fate_parent: text('__fate_parent'),
    __fate_rank: text('__fate_rank'),
    id: integer('id').primaryKey(),
    parentId: integer('parentId'),
    rank: integer('rank'),
  });
  const tagTable = sqliteTable('Tag', { id: integer('id').primaryKey(), rank: integer('rank') });
  const linkTable = sqliteTable('ParentTag', {
    parentId: integer('parentId'),
    tagId: integer('tagId'),
  });
  const tag = dataView<{ id: number; rank: number | null }>('Tag')({ id: true, rank: true });
  const child = dataView<{
    __fate_parent: string;
    __fate_rank: string;
    id: number;
    rank: number | null;
    tag: { id: number; rank: number | null } | null;
  }>('Child')({ __fate_parent: true, __fate_rank: true, id: true, rank: true, tag });
  const parent = dataView<{
    children: Array<{ id: number }>;
    id: number;
    tags: Array<{ id: number }>;
  }>('Parent')({ children: list(child), id: true, tags: list(tag) });
  const queries: Array<string> = [];
  let active = 0;
  let peak = 0;
  let rowsRead = 0;
  const db = drizzle(async (sql, params) => {
    queries.push(sql);
    peak = Math.max(peak, ++active);
    try {
      if (latency) {
        await new Promise((resolve) => setTimeout(resolve, latency));
      }
      const statement = sqlite.prepare(sql);
      statement.setReturnArrays(true);
      const rows = statement.all(...(params as Array<number | string | null>));
      rowsRead += rows.length;
      return { rows };
    } finally {
      active--;
    }
  });
  const run = async ({
    args = { children: { first: 2 } },
    batching = true,
    concurrency = 10,
    direction = 'asc',
    fields = ['children.id', 'children.rank'],
  }: {
    args?: Record<string, Record<string, string | number | undefined>>;
    batching?: boolean;
    concurrency?: number;
    direction?: 'asc' | 'desc';
    fields?: Array<string>;
  } = {}) => {
    const adapter = createDrizzleSourceAdapter({
      db,
      nestedPaginationBatching: batching,
      nestedPaginationConcurrency: concurrency,
      views: [
        {
          manyToMany: { tags: linkTable },
          relations: {
            children: { foreignKey: 'parentId', localKey: 'id' },
            tags: {
              foreignKey: 'id',
              localKey: 'id',
              through: { foreignKey: 'tagId', localKey: 'parentId' },
            },
          },
          table: parentTable,
          view: parent,
        },
        {
          orderBy: [{ direction, field: 'rank' }],
          relations: { tag: { foreignKey: 'id', localKey: 'rank' } },
          table: childTable,
          view: child,
        },
        { orderBy: [{ direction, field: 'rank' }], table: tagTable, view: tag },
      ],
    });
    const plan = createSourcePlan({ args, select: fields, source: adapter.getSource(parent) });
    queries.length = 0;
    peak = 0;
    rowsRead = 0;
    const result = await adapter.fetchByIds({
      ids: Array.from({ length: count }, (_, i) => String(i + 1)),
      plan,
    });
    return { peak, queries: [...queries], result, rowsRead };
  };
  return { close: () => sqlite.close(), run };
}
