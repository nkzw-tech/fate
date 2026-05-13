import { join } from 'node:path';
import nkzw from '@nkzw/oxlint-config';
import dotenv from 'dotenv';
import { defineConfig } from 'vite-plus';

const root = process.cwd();

dotenv.config({
  path: join(root, './server', '.env'),
  quiet: true,
});

export default defineConfig({
  fmt: {
    experimentalSortImports: {
      newlinesBetween: false,
    },
    experimentalSortPackageJson: {
      sortScripts: true,
    },
    experimentalTailwindcss: {
      stylesheet: 'client/src/App.css',
    },
    ignorePatterns: [
      'coverage/',
      'dist/',
      '.fate/',
      'client/dist/',
      'client/src/translations/',
      'server/dist/',
      'pnpm-lock.yaml',
    ],
    singleQuote: true,
  },
  lint: {
    extends: [nkzw],
    ignorePatterns: [
      'coverage',
      'dist',
      '.fate',
      'client/dist',
      'server/dist',
      'server/src/prisma/pothos-types.ts',
      'server/src/prisma/prisma-client/*',
      'vite.config.ts.timestamp-*',
      'client/vite.config.ts.timestamp-*',
      'server/vite.config.ts.timestamp-*',
    ],
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        files: ['server/src/index.tsx', 'server/src/prisma/seed.tsx', '**/__tests__/**'],
        rules: {
          'no-console': 'off',
        },
      },
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
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
