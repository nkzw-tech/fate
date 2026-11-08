import nkzw from '@nkzw/oxlint-config';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    experimentalSortImports: {
      newlinesBetween: false,
    },
    experimentalSortPackageJson: {
      sortScripts: true,
    },
    ignorePatterns: ['coverage/', 'dist/', 'pnpm-lock.yaml', 'src/graphql/schema.graphql'],
    singleQuote: true,
  },
  lint: {
    extends: [nkzw],
    ignorePatterns: ['dist/', 'src/prisma/pothos-types.ts', 'src/prisma/prisma-client/**'],
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        files: ['scripts/**/*.tsx', 'src/app.tsx', 'src/index.tsx', 'src/prisma/seed.tsx'],
        rules: {
          'no-console': 'off',
        },
      },
    ],
  },
  pack: {
    deps: { resolveDepSubpath: true },
    entry: ['./src/app.tsx'],
    outputOptions: { codeSplitting: false, entryFileNames: 'index.js' },
  },
  run: {
    tasks: {
      'test:all': {
        command: 'vp check && vp test',
      },
    },
  },
  staged: {
    '*': 'vp check --fix',
  },
});
