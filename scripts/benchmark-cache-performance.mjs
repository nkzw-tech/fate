import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import process from 'node:process';
import { URL, URLSearchParams } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { build, preview } from 'vite';

const [engine = 'chromium', samples = '7', reportPath] = process.argv.slice(2);
const browserType = { chromium, webkit }[engine];
if (!browserType || ![samples].every((n) => Number.isSafeInteger(+n) && +n > 0)) {
  throw new Error(
    'Usage: benchmark-cache-performance.mjs [chromium|webkit] [samples] [report.json]',
  );
}
const repository = resolve(import.meta.dirname, '..');
const root = resolve(repository, 'packages/fate-indexeddb/src/__tests__');
const outDir = await mkdtemp(resolve(tmpdir(), 'fate-view-updates-'));
const baseline = process.env.FATE_BENCH_BASELINE;
let browser;
let server;
try {
  await build({
    build: {
      minify: true,
      outDir,
      rollupOptions: { input: resolve(root, 'cache-performance-benchmark.html') },
      target: 'esnext',
    },
    configFile: false,
    logLevel: 'error',
    plugins: baseline
      ? [
          {
            enforce: 'pre',
            load(id) {
              const path = relative(repository, id);
              if (
                /^packages\/(fate|fate-indexeddb)\/src\/.*\.tsx?$/.test(path) &&
                !path.includes('/__tests__/')
              ) {
                return execFileSync('git', ['show', `${baseline}:${path}`], {
                  cwd: repository,
                  encoding: 'utf8',
                  maxBuffer: 10_000_000,
                });
              }
            },
            name: 'benchmark-baseline-runtime',
          },
        ]
      : [],
    resolve: { conditions: ['@nkzw/source', 'module', 'browser', 'production'] },
    root,
  });
  server = await preview({
    build: { outDir },
    configFile: false,
    logLevel: 'error',
    preview: { host: 'localhost', port: 0 },
    root,
  });
  browser = await browserType.launch();
  const page = await browser.newPage();
  const failed = new Promise((_, reject) => page.once('pageerror', reject));
  const run = async () => {
    await page.goto(
      new URL(
        `cache-performance-benchmark.html?${new URLSearchParams({ samples })}`,
        server.resolvedUrls.local[0],
      ).href,
    );
    const output = page.locator('#output[data-done]');
    await output.waitFor({ timeout: 180_000 });
    const body = await output.textContent();
    if (JSON.parse(body).error) {
      throw new Error(body);
    }
    return JSON.parse(body);
  };
  const report = {
    baseline: baseline ?? null,
    browser: engine,
    version: browser.version(),
    ...(await Promise.race([run(), failed])),
  };
  console.log(JSON.stringify(report, null, 2));
  if (reportPath) {
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server ? server.httpServer.close((error) => (error ? reject(error) : resolve())) : resolve(),
  );
  await rm(outDir, { force: true, recursive: true });
}
