import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'vite-plus/test';

test.each(['single', 'multiple', 'commit', 'rollback'])(
  'releases client computation and mutation data after %s',
  (scenario) => {
    execFileSync(
      process.execPath,
      [
        '--expose-gc',
        '--no-warnings',
        '--import',
        '@oxc-node/core/register',
        fileURLToPath(new URL('./fixtures/client-state-retention.ts', import.meta.url)),
        scenario,
      ],
      { timeout: 10_000 },
    );
  },
);
