import console from 'node:console';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL, URLSearchParams } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';

const [engine = 'chromium', records = '100', samples = '15'] = process.argv.slice(2);
const browserType = { chromium, webkit }[engine];
const percentile = (values, q) => values.sort((a, b) => a - b)[Math.ceil(q * values.length) - 1];
if (!browserType) {
  throw new Error('Usage: benchmark-client-persistence.mjs [chromium|webkit] [records] [samples]');
}

const server = await createServer({
  configFile: false,
  resolve: { conditions: ['@nkzw/source', 'module', 'browser', 'development'] },
  root: resolve(import.meta.dirname, '..'),
  server: { host: 'localhost', port: 0 },
});
let browser;
try {
  await server.listen();
  const params = new URLSearchParams({ records, samples });
  const url = new URL(
    `/packages/fate-indexeddb/src/__tests__/client-persistence-benchmark.html?${params}`,
    server.resolvedUrls.local[0],
  );
  browser = await browserType.launch();
  const page = await browser.newPage();
  const pageError = new Promise((_, reject) => page.once('pageerror', reject));
  const benchmark = async () => {
    await page.goto(url.href);
    const report = page.locator('pre[data-status]');
    await report.waitFor({ timeout: 120_000 });
    const body = await report.textContent();
    if ((await report.getAttribute('data-status')) !== 'done') {
      throw new Error(body);
    }
    return JSON.parse(body);
  };
  const { recordCount, ...operations } = await Promise.race([benchmark(), pageError]);
  console.log(`${engine} ${browser.version()}, ${recordCount} saved documents`);
  console.table(
    Object.fromEntries(
      Object.entries(operations).map(([name, values]) => [
        name,
        {
          'max frame gap ms': Math.max(...values.map(({ maxFrameGapMs }) => maxFrameGapMs)).toFixed(
            2,
          ),
          'p50 ms': percentile(
            values.map(({ elapsedMs }) => elapsedMs),
            0.5,
          ).toFixed(2),
          'p95 ms': percentile(
            values.map(({ elapsedMs }) => elapsedMs),
            0.95,
          ).toFixed(2),
          'read bytes p50': percentile(
            values.map(({ readBytes }) => readBytes),
            0.5,
          ),
          samples: values.length,
          'write bytes p50': percentile(
            values.map(({ writeBytes }) => writeBytes),
            0.5,
          ),
        },
      ]),
    ),
  );
} finally {
  await browser?.close();
  await server.close();
}
