import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const [engine = 'node', reportPath] = process.argv.slice(2);
if (!['node', 'chromium'].includes(engine)) {
  throw new Error('Usage: benchmark-memory.mjs [node|chromium] [report.json]');
}
const repository = resolve(import.meta.dirname, '..');
const root = resolve(repository, 'packages/fate-indexeddb/src/__tests__');
const outDir = await mkdtemp(resolve(tmpdir(), 'fate-memory-'));
const baseline = process.env.FATE_BENCH_BASELINE;
let browser;
let server;
try {
  await build({
    build: {
      minify: true,
      outDir,
      rollupOptions:
        engine === 'node'
          ? { output: { entryFileNames: 'benchmark.mjs' } }
          : { input: resolve(root, 'memory-benchmark.html') },
      ssr:
        engine === 'node'
          ? resolve(repository, 'packages/fate/src/__tests__/memory-benchmark.ts')
          : undefined,
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
    ssr: { noExternal: true },
  });
  let results;
  if (engine === 'node') {
    results = JSON.parse(
      execFileSync(process.execPath, ['--expose-gc', resolve(outDir, 'benchmark.mjs')], {
        encoding: 'utf8',
        timeout: 300_000,
      }),
    );
  } else {
    server = await preview({
      build: { outDir },
      configFile: false,
      logLevel: 'error',
      preview: { host: 'localhost', port: 0 },
      root,
    });
    browser = await chromium.launch();
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    await page.exposeFunction('fateMemoryCheckpoint', async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      await cdp.send('HeapProfiler.collectGarbage');
      return cdp.send('Runtime.getHeapUsage');
    });
    const failed = new Promise((_, reject) => page.once('pageerror', reject));
    const run = async () => {
      await page.goto(`${server.resolvedUrls.local[0]}memory-benchmark.html`);
      const output = page.locator('#output[data-done]');
      await output.waitFor({ timeout: 300_000 });
      const body = JSON.parse(await output.textContent());
      if (body.error) {
        throw new Error(JSON.stringify(body));
      }
      return body;
    };
    results = await Promise.race([run(), failed]);
  }
  const report = {
    baseline: baseline ?? null,
    engine,
    version: browser?.version() ?? process.version,
    ...results,
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
