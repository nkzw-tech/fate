import { expect, test } from 'vite-plus/test';
import { createQueryLimiter } from '../query-limiter.ts';
import { paginationFixture } from './fixtures/pagination.ts';

for (const direction of ['asc', 'desc'] as const) {
  for (const args of [
    { first: 2 },
    { last: 2 },
    { after: '12', first: 2 },
    { before: '16', last: 2 },
    { after: 'missing', first: 2 },
    { first: 0 },
  ]) {
    test(`grouped pagination matches per-parent pages (${direction}, ${JSON.stringify(args)})`, async () => {
      const fixture = paginationFixture(5);
      try {
        const options = {
          args: {
            children: args,
            tags: {
              ...args,
              ...('after' in args ? { after: '3' } : 'before' in args ? { before: '6' } : {}),
            },
          },
          direction,
          fields: [
            'children.id',
            'children.rank',
            'children.__fate_parent',
            'children.__fate_rank',
            'tags.id',
            'tags.rank',
          ],
        };
        const before = await fixture.run({ ...options, batching: false });
        const after = await fixture.run(options);
        expect(after.result).toEqual(before.result);
        expect(after.queries.some((query) => query.includes('row_number()'))).toBe(true);
        expect(after.queries.length).toBeLessThan(before.queries.length);
      } finally {
        fixture.close();
      }
    });
  }
}

test('grouped pagination preserves fields mapped to the generated SQL column names', async () => {
  const fixture = paginationFixture(3, 0, { renameFields: true });
  try {
    const fields = ['children.id', 'children.displayName', 'children.sortName'];
    const before = await fixture.run({ batching: false, fields });
    const after = await fixture.run({ batching: true, fields });
    expect(after.result).toEqual(before.result);
    expect(after.queries).toHaveLength(2);
  } finally {
    fixture.close();
  }
});

test('nested pagination preserves results for date-valued relation keys', async () => {
  const fixture = paginationFixture(3, 0, { dateKeys: true });
  try {
    const before = await fixture.run({ batching: false });
    const after = await fixture.run({ batching: true });
    expect(before.result[0]).toMatchObject({
      children: { items: [{ node: { id: 11 } }, { node: { id: 12 } }] },
    });
    expect(after.result).toEqual(before.result);
  } finally {
    fixture.close();
  }
});

test('grouped pagination bounds the rows fetched and chunks large parent sets', async () => {
  const fixture = paginationFixture(260);
  try {
    const before = await fixture.run({ batching: false });
    const after = await fixture.run();
    expect(after.result).toEqual(before.result);
    expect(after.queries).toHaveLength(4); // Parent query plus three windows.
    expect(after.rowsRead).toBe(260 + 259 * 3);
  } finally {
    fixture.close();
  }
});

test.each([true, false])(
  'sibling hydration shares the query concurrency limit (batching: %s)',
  async (batching) => {
    const fixture = paginationFixture(6, 1);
    try {
      const result = await fixture.run({
        args: { children: { first: 2 }, tags: { first: 2 } },
        batching,
        concurrency: 2,
        fields: ['children.id', 'tags.id'],
      });
      expect(result.peak).toBe(2);
      expect(result.result).toHaveLength(6);
    } finally {
      fixture.close();
    }
  },
);

test('query failures release a reserved slot for queued work', async () => {
  const run = createQueryLimiter(1);
  const pending = Promise.withResolvers<void>();
  const failed = run(async () => {
    await pending.promise;
    throw new Error('Query failed');
  });
  const next = run(() => 42);
  pending.resolve();
  await expect(failed).rejects.toThrow('Query failed');
  await expect(next).resolves.toBe(42);
});

test('recursive hydration keeps the same results and shares its siblings query budget', async () => {
  const fixture = paginationFixture(6, 1);
  try {
    const options = {
      args: { children: { first: 4 }, tags: { first: 2 } },
      concurrency: 2,
      fields: ['children.id', 'children.tag.id', 'tags.id'],
    };
    const before = await fixture.run({ ...options, batching: false });
    const after = await fixture.run(options);
    expect(after.result).toEqual(before.result);
    expect(before.peak).toBeLessThanOrEqual(2);
    expect(after.peak).toBeLessThanOrEqual(2);
    expect(after.queries).toHaveLength(4);
  } finally {
    fixture.close();
  }
});

test('a positive fractional concurrency budget still allows queries to make progress', async () => {
  const fixture = paginationFixture(3, 1);
  try {
    const result = await fixture.run({ concurrency: 0.5 });
    expect(result.peak).toBe(1);
    expect(result.result).toHaveLength(3);
  } finally {
    fixture.close();
  }
});
