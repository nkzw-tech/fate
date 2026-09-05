import { eq, type SQL } from 'drizzle-orm';
import { PgDialect, pgTable, text } from 'drizzle-orm/pg-core';
import { expect, test, vi } from 'vite-plus/test';
import { dataView } from '../dataView.ts';
import { createDrizzleSourceAdapter } from '../drizzle.ts';
import { createPrismaSourceAdapter } from '../prisma.ts';

const userView = dataView<{ id: string }>('User')({ id: true });

for (const byId of [false, true]) {
  test(`Drizzle ${byId ? 'byId' : 'byIds'} preserves tenant and ID constraints`, async () => {
    const table = pgTable('User', { id: text('id'), tenant: text('tenant') });
    const conditions: Array<SQL> = [];
    const builder = {
      orderBy: async () => [],
      where: (condition: SQL) => {
        conditions.push(condition);
        return builder;
      },
    };
    const adapter = createDrizzleSourceAdapter({
      db: { select: () => ({ from: () => builder }) },
      views: [{ table, view: userView }],
    });
    const options = {
      ctx: {},
      extra: { where: eq(table.tenant, 'allowed-tenant') },
      input: { select: ['id'] },
      view: userView,
    };
    if (byId) {
      await adapter.resolveById({ ...options, id: 'requested-user' });
    } else {
      await adapter.resolveByIds({ ...options, ids: ['requested-user'] });
    }
    expect(conditions).toHaveLength(1);
    const query = new PgDialect().sqlToQuery(conditions[0]);
    expect(query.sql).toContain('"User"."tenant" =');
    expect(query.sql).toContain('"User"."id" in');
    expect(query.sql).toContain(' and ');
    expect(query.params).toEqual(expect.arrayContaining(['allowed-tenant', 'requested-user']));
  });
}

for (const method of ['byIds', 'byId', 'byIdFallback'] as const) {
  test(`Prisma ${method} preserves tenant constraints, including a conflicting ID filter`, async () => {
    const findMany = vi.fn(async () => []);
    const findUnique = vi.fn(async () => null);
    const adapter = createPrismaSourceAdapter({
      views: [
        {
          delegate: () => ({ findMany, ...(method === 'byId' ? { findUnique } : {}) }),
          view: userView,
        },
      ],
    });
    const where = { id: { not: 'requested-user' }, tenant: 'allowed-tenant' };
    const options = { ctx: {}, extra: { where }, input: { select: ['id'] }, view: userView };
    if (method === 'byIds') {
      await adapter.resolveByIds({ ...options, ids: ['requested-user'] });
    } else {
      await adapter.resolveById({ ...options, id: 'requested-user' });
    }
    expect(method === 'byId' ? findUnique : findMany).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        AND: [where],
        id: method === 'byId' ? 'requested-user' : { in: ['requested-user'] },
      },
    });
  });
}
