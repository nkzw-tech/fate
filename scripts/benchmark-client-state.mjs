import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import process from 'node:process';
import { URL, URLSearchParams } from 'node:url';
import { chromium, webkit } from '@playwright/test';
import { build, preview } from 'vite';

const [engine = 'chromium', records = '1000', samples = '30', reportPath] = process.argv.slice(2);
const browserType = { chromium, webkit }[engine];
const memory = engine === 'node';
const baseline = process.env.FATE_BENCH_BASELINE;
const repository = resolve(import.meta.dirname, '..');
if (
  (!browserType && !memory) ||
  ![records, samples].every((value) => Number.isSafeInteger(Number(value)) && Number(value) > 0)
) {
  throw new Error(
    'Usage: benchmark-client-state.mjs [chromium|webkit|node] [records] [samples] [report.json]',
  );
}
const root = resolve(import.meta.dirname, '../packages/fate/src/__tests__');
const outDir = await mkdtemp(resolve(tmpdir(), 'fate-client-state-'));
const percentile = (values, q) =>
  [...values].sort((a, b) => a - b)[Math.ceil(q * values.length) - 1];
let browser;
let server;
try {
  await build({
    build: {
      minify: true,
      outDir,
      ...(memory ? { ssr: resolve(root, 'fixtures/client-state-memory.ts') } : {}),
      rollupOptions: {
        ...(!memory ? { input: resolve(root, 'client-state-benchmark.html') } : {}),
        output: { entryFileNames: memory ? 'benchmark.mjs' : 'assets/[name]-[hash].js' },
      },
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
                path.startsWith('packages/fate/src/') &&
                !path.includes('/__tests__/') &&
                path.endsWith('.ts')
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
    root,
    ...(memory ? { ssr: { noExternal: true } } : {}),
  });
  let report;
  if (memory) {
    report = JSON.parse(
      execFileSync(
        process.execPath,
        ['--expose-gc', resolve(outDir, 'benchmark.mjs'), records, samples],
        {
          encoding: 'utf8',
          maxBuffer: 10_000_000,
          timeout: 300_000,
        },
      ),
    );
    console.log(
      `Node ${report.node}, ${records} related records, ${samples} iterations, sampled allocation and post-GC retained heap`,
    );
    console.log(`Populated graph and view heap: ${report.populatedHeapBytes} bytes`);
    console.table(report.results);
  } else {
    server = await preview({
      build: { outDir },
      configFile: false,
      logLevel: 'error',
      preview: { host: 'localhost', port: 0 },
      root,
    });
    const url = new URL(
      `client-state-benchmark.html?${new URLSearchParams({ records, samples })}`,
      server.resolvedUrls.local[0],
    );
    browser = await browserType.launch();
    const page = await browser.newPage();
    const pageError = new Promise((_, reject) => page.once('pageerror', reject));
    const benchmark = async () => {
      await page.goto(url.href);
      const output = page.locator('pre[data-status]');
      await output.waitFor({ timeout: 180_000 });
      const body = await output.textContent();
      if ((await output.getAttribute('data-status')) !== 'done') {
        throw new Error(body);
      }
      return JSON.parse(body);
    };
    report = {
      browser: engine,
      version: browser.version(),
      ...(await Promise.race([benchmark(), pageError])),
    };
    console.log(`${engine} ${report.version}, ${records} related records, production bundle`);
    console.table(
      Object.fromEntries(
        Object.entries(report.results).map(([name, { batchSize, elapsedMs }]) => [
          name,
          {
            batchSize,
            'p50 ms/op': percentile(elapsedMs, 0.5).toFixed(4),
            'p95 ms/op': percentile(elapsedMs, 0.95).toFixed(4),
            samples: elapsedMs.length,
          },
        ]),
      ),
    );
  }
  report.baseline = baseline ?? null;
  if (reportPath) {
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server ? server.httpServer.close((error) => (error ? reject(error) : resolve())) : resolve(),
  );
  await rm(outDir, { force: true, recursive: true });
}
