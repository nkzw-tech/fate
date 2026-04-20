import { join } from 'node:path';
import findWorkspaces from '@nkzw/find-workspaces';
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
    extends: [nkzw],
    ignorePatterns: [
      '.vitepress/cache',
      '.vitepress/dist',
      'coverage',
      'dist',
      'example/client/src/fate.ts',
      'example/server/src/prisma/pothos-types.ts',
      'example/server/src/prisma/prisma-client/*',
      'packages/**/lib',
    ],
    jsPlugins: [
      'eslint-plugin-workspaces',
      { name: 'import-x-js', specifier: 'eslint-plugin-import-x' },
    ],
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        files: [
          'example/server/scripts/**/*.tsx',
          'example/server/src/index.tsx',
          'example/server/src/prisma/seed.tsx',
          'packages/fate/src/cli.ts',
          'scripts/**',
          '**/__tests__/**',
        ],
        rules: {
          'no-console': 'off',
          'react-hooks-js/globals': 'off',
        },
      },
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'import-x-js/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: [
            './.vitepress/**',
            './oxlint.config.ts',
            './example/client/vite.config.ts',
            './example/server/prisma.config.ts',
            './example/server/scripts/**/*.tsx',
            '**/__tests__/**',
            '**/tsdown.config.js',
            'vite.config.ts',
          ],
          packageDir: findWorkspaces(import.meta.dirname),
        },
      ],
      'workspaces/no-absolute-imports': 'error',
      'workspaces/no-relative-imports': 'error',
    },
  },
});
