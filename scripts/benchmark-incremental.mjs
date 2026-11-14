import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import process from 'node:process';
import { build } from 'vite';

const [samples = '15', reportPath] = process.argv.slice(2);
if (!Number.isSafeInteger(+samples) || +samples < 2) {
  throw new Error('Usage: benchmark-incremental.mjs [samples > 1] [report.json]');
}
const repository = resolve(import.meta.dirname, '..');
const outDir = await mkdtemp(resolve(tmpdir(), 'fate-incremental-'));
const baseline = process.env.FATE_BENCH_BASELINE;
try {
  await build({
    build: {
      minify: true,
      outDir,
      rollupOptions: { output: { entryFileNames: 'benchmark.mjs' } },
      ssr: resolve(repository, 'packages/fate/src/__tests__/incremental-benchmark.ts'),
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
    ssr: { noExternal: true },
  });
  const report = {
    baseline: baseline ?? null,
    node: process.version,
    ...JSON.parse(
      execFileSync(process.execPath, ['--no-warnings', resolve(outDir, 'benchmark.mjs'), samples], {
        encoding: 'utf8',
        timeout: 180_000,
      }),
    ),
  };
  console.log(JSON.stringify(report, null, 2));
  if (reportPath) {
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
} finally {
  await rm(outDir, { force: true, recursive: true });
}
