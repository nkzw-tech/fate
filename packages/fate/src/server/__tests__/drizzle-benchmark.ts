import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { paginationFixture } from './fixtures/pagination.ts';

const [parents = '100', samples = '15', latency = '0'] = process.argv.slice(2);
const fixture = paginationFixture(Number(parents), Number(latency));
const summarize = (values: Array<number>) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    values,
  };
};
try {
  const scenarios = {
    cursorPage: {
      args: { children: { after: '12', first: 2 } },
      fields: ['children.id', 'children.rank'],
    },
    firstPage: { args: { children: { first: 2 } }, fields: ['children.id', 'children.rank'] },
    siblings: {
      args: { children: { first: 2 }, tags: { first: 2 } },
      fields: ['children.id', 'tags.id'],
    },
  };
  const results: Record<string, unknown> = {};
  for (const [name, options] of Object.entries(scenarios)) {
    const expected = await fixture.run({ ...options, batching: false });
    const elapsed: Array<number> = [];
    const queries: Array<number> = [];
    const peaks: Array<number> = [];
    for (let i = 0; i < Number(samples) + 3; i++) {
      const start = performance.now();
      const result = await fixture.run({ ...options, batching: true });
      const duration = performance.now() - start;
      assert.deepEqual(result.result, expected.result);
      if (i >= 3) {
        elapsed.push(duration);
        queries.push(result.queries.length);
        peaks.push(result.peak);
      }
    }
    results[name] = {
      elapsedMs: summarize(elapsed),
      maxConcurrentQueries: Math.max(...peaks),
      queryCounts: queries,
    };
  }
  console.log(
    JSON.stringify({ latencyMs: +latency, parents: +parents, results, samples: +samples }),
  );
} finally {
  fixture.close();
}
