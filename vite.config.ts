import { join } from 'node:path';
import nkzw from '@nkzw/oxlint-config/vite-plus/with-sorting';
import dotenv from 'dotenv';
import { defineConfig } from 'vite-plus';
import { configDefaults } from 'vite-plus';

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
      '**/.void/**',
      'example/client/dist/',
      'example/client/src/translations/',
      'example/server-graphql/src/graphql/schema.graphql',
      'example/server-prisma/dist',
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
      '**/.void/**',
      'example/server-prisma/src/prisma/pothos-types.ts',
      'example/server-prisma/src/prisma/prisma-client/**',
      'example/server-graphql/src/prisma/pothos-types.ts',
      'example/server-graphql/src/prisma/prisma-client/**',
      'src/prisma/pothos-types.ts',
      'src/prisma/prisma-client/**',
      'example/server-drizzle/src/drizzle/migrations/**',
      'packages/create-fate/templates',
      'packages/**/lib',
    ],
    jsPlugins: ['eslint-plugin-workspaces'],
    options: { typeCheck: true },
    overrides: [
      {
        // These library paths read arbitrary entity, transport, or storage fields before narrowing their values.
        files: [
          'packages/fate-devtools/src/__tests__/devtools.test.ts',
          'packages/fate-devtools/src/index.ts',
          'packages/fate-devtools/src/serialize.ts',
          'packages/fate/src/**',
          'packages/react-fate/src/__tests__/deferred-hook-errors.test.tsx',
          'packages/react-fate/src/__tests__/useViewLifecycle.test.tsx',
          'packages/react-fate/src/listView.ts',
          'packages/void-fate/src/server.ts',
          'packages/vue-fate/src/__tests__/useView.test.ts',
          'packages/vue-fate/src/listView.ts',
        ],
        rules: { 'quality/no-unsafe-dictionary-type': 'off' },
      },
      {
        // Transport, storage, and instrumentation boundaries pass opaque results to their callers.
        files: [
          'packages/fate-devtools/src/__tests__/devtools.test.ts',
          'packages/fate-devtools/src/index.ts',
          'packages/fate-devtools/src/vite.ts',
          'packages/fate-indexeddb/src/__tests__/client-persistence-benchmark.ts',
          'packages/fate-indexeddb/src/__tests__/index.test.ts',
          'packages/fate/src/**',
          'packages/react-fate/src/__tests__/requestTimeout.test.tsx',
          'packages/react-fate/src/__tests__/useRefetch.test.tsx',
          'packages/react-fate/src/useViewSnapshots.ts',
        ],
        rules: { 'quality/no-unknown-returns': 'off' },
      },
      {
        // These APIs use object identity for weak keys, scopes, and runtime inspection.
        files: [
          'packages/fate-devtools/src/index.ts',
          'packages/fate-devtools/src/serialize.ts',
          'packages/fate/src/__tests__/client-state.test.ts',
          'packages/fate/src/__tests__/list-invalidation.test.ts',
          'packages/fate/src/client.ts',
          'packages/fate/src/codegen/__tests__/graphql.test.ts',
          'packages/fate/src/hydration.ts',
          'packages/fate/src/mutation.ts',
          'packages/fate/src/normalization-input.ts',
          'packages/fate/src/render-read-errors.ts',
        ],
        rules: { 'quality/no-object-parameters': 'off' },
      },
      {
        env: { browser: true },
        files: ['.vitepress/**/*.vue'],
        globals: { defineProps: 'readonly' },
      },
      {
        files: [
          'example/server-prisma/scripts/**/*.tsx',
          'example/server-prisma/src/index.tsx',
          'example/server-prisma/src/prisma/seed.tsx',
          'example/server-graphql/scripts/**/*.tsx',
          'example/server-graphql/src/app.tsx',
          'example/server-graphql/src/index.tsx',
          'example/server-graphql/src/prisma/seed.tsx',
          'example/server-drizzle/src/index.tsx',
          'example/server-drizzle/src/drizzle/seed.tsx',
          'example/void/db/seed.ts',
          'scripts/**',
          '**/__tests__/**',
        ],
        rules: {
          'no-console': 'off',
          'react/globals': 'off',
        },
      },
      {
        files: ['packages/vue-fate/**', 'example/client-vue/**'],
        rules: {
          'no-undef': 'off',
          'react-hooks/rules-of-hooks': 'off',
          'react/globals': 'off',
          'react/immutability': 'off',
        },
      },
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'workspaces/no-absolute-imports': 'error',
      'workspaces/no-relative-imports': 'error',
    },
  },
  run: {
    tasks: {
      'build:all': {
        command: ['vp run -r build', 'vp run generate-readme', 'vp run copy-files'],
      },
      'build:api-docs': {
        cache: {
          input: [{ auto: true }, '!docs/api', '!docs/api/**'],
          output: ['docs/api/**'],
        },
        command:
          "pnpm --filter '@nkzw/fate-docs-toolchain' exec typedoc --options ../../typedoc.json",
      },
      'build:docs': {
        command: ['vp run build:api-docs', 'vp run copy-package-docs', 'vitepress build'],
      },
      'dev:setup': {
        command: [
          "vp run --filter '@nkzw/fate' build",
          'vp run --filter react-fate build',
          'vp run --filter vue-fate build',
          'vp run --filter void-fate build',
          "vp run --filter '@nkzw/fate-devtools' build",
          "vp run --filter '@nkzw/fate-server' dev:setup",
          "vp run --filter '@nkzw/fate-server-graphql' dev:setup",
          'vp run fate:generate',
          "vp run --filter '@nkzw/fate-client' prepare:void",
          "vp run --filter '@nkzw/fate-void-example' prepare:void",
          "vp run --filter '@nkzw/fate-void-example' fate:generate",
          'vp run build:api-docs',
        ],
      },
      'fate:generate': {
        cache: {
          input: [
            { auto: true },
            '!example/client',
            '!example/client/.fate',
            '!example/client/.fate/**',
            '!example/client/.void',
            '!example/client/.void/**',
          ],
          output: ['example/client/.fate/**', 'example/client/.void/**'],
        },
        command:
          'OXC_TSCONFIG_PATH=../../tsconfig.json node --conditions=development --no-warnings --import @oxc-node/core/register ../../packages/fate/src/cli.ts generate',
        cwd: 'example/client',
      },
      'test:all': {
        command: ['vp run dev:setup', 'vp check', 'vp test'],
      },
    },
  },
  staged: {
    '*': 'vp check --fix',
  },
  test: {
    clearMocks: true,
    exclude: [
      ...configDefaults.exclude,
      '.template-tests/**',
      'packages/create-fate/templates/fate/{drizzle,graphql,graphql-client,http,prisma,void}/**',
    ],
  },
});
