import { defineConfig } from '@playwright/test';

const url = 'http://localhost:6013/';

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: true,
  outputDir: '../../../../node_modules/.cache/fate-selective-hydration',
  testMatch: 'hydration.browser.ts',
  use: { baseURL: url },
  webServer: {
    command: [
      'vp run --filter "@nkzw/fate" build',
      'vp run --filter react-fate build',
      'vp dev --config example/client/__tests__/selective-hydration/vite.config.ts',
    ].join(' && '),
    cwd: '../../../..',
    url,
  },
});
