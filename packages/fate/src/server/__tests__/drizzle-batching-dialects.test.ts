import { int, mysqlTable } from 'drizzle-orm/mysql-core';
import { drizzle as mysql } from 'drizzle-orm/mysql-proxy';
import { integer, pgTable } from 'drizzle-orm/pg-core';
import { drizzle as postgres } from 'drizzle-orm/pg-proxy';
import { expect, test } from 'vite-plus/test';
import { dataView, list } from '../dataView.ts';
import { createDrizzleSourceAdapter } from '../drizzle.ts';
import { createSourcePlan } from '../source.ts';

for (const dialect of ['postgres', 'mysql'] as const) {
  test(`${dialect} compiles and decodes grouped pages through its Drizzle driver`, async () => {
    const queries: Array<string> = [];
    const execute = async (query: string) => {
      queries.push(query);
      // Drizzle maps these positional rows using the generated subquery selection.
      return {
        rows:
          queries.length === 1
            ? [[1], [2]]
            : [
                [11, 1, 1],
                [21, 2, 1],
              ],
      };
    };
    const parentTable =
      dialect === 'postgres'
        ? pgTable('Parent', { id: integer('id').primaryKey() })
        : mysqlTable('Parent', { id: int('id').primaryKey() });
    const childTable =
      dialect === 'postgres'
        ? pgTable('Child', { id: integer('id').primaryKey(), parentId: integer('parentId') })
        : mysqlTable('Child', { id: int('id').primaryKey(), parentId: int('parentId') });
    const child = dataView<{ id: number }>('Child')({ id: true });
    const parent = dataView<{ children: Array<{ id: number }>; id: number }>('Parent')({
      children: list(child),
      id: true,
    });
    const adapter = createDrizzleSourceAdapter({
      db: dialect === 'postgres' ? postgres(execute) : mysql(execute),
      views: [
        {
          relations: { children: { foreignKey: 'parentId', localKey: 'id' } },
          table: parentTable,
          view: parent,
        },
        { table: childTable, view: child },
      ],
    });
    const plan = createSourcePlan({
      args: { children: { first: 1 } },
      select: ['children.id'],
      source: adapter.getSource(parent),
    });
    const result = await adapter.fetchByIds({ ids: ['1', '2'], plan });
    expect(queries).toHaveLength(2);
    expect(queries[1]).toContain('row_number() over (partition by');
    expect(result).toMatchObject([
      { children: { items: [{ node: { id: 11 } }], pagination: { hasNext: false } }, id: 1 },
      { children: { items: [{ node: { id: 21 } }], pagination: { hasNext: false } }, id: 2 },
    ]);
  });
}
