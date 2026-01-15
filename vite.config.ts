import dotenv from 'dotenv';
import { join } from 'node:path';
import { defineConfig } from 'vite-plus';

const root = process.cwd();

dotenv.config({
  path: join(root, './server', '.env'),
  quiet: true,
});

export default defineConfig({
  fmt: {
    $schema: './node_modules/oxfmt/configuration_schema.json',
    experimentalSortImports: {
      newlinesBetween: false,
    },
    experimentalSortPackageJson: {
      sortScripts: true,
    },
    experimentalTailwindcss: {
      stylesheet: 'example/client/src/App.css',
    },
    ignorePatterns: [
      '.vitepress/cache',
      '.vitepress/dist',
      'coverage/',
      'dist/',
      'example/client/dist/',
      'example/client/src/fate.ts',
      'example/client/src/translations/',
      'example/server/dist',
      'pnpm-lock.yaml',
    ],
    singleQuote: true,
  },
  lint: {
    ignorePatterns: ['**/*.ts', '**/*.tsx'],
  },
});
