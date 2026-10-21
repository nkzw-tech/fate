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
    rules: {
      'import-x-js/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: [
            './prisma.config.ts',
            './scripts/**/*.tsx',
            './src/index.test.tsx',
            './vite.config.ts',
          ],
        },
      ],
    },
  },
  pack: {
    deps: { resolveDepSubpath: true },
    entry: ['./src/app.tsx'],
    outputOptions: {
      codeSplitting: false,
      entryFileNames: 'index.js',
    },
  },
  run: {
    tasks: {
      build: {
        cache: {
          input: [{ auto: true }, '!dist', '!dist/**'],
          output: ['dist/**'],
        },
        command: 'vp pack',
      },
      'db:generate': {
        cache: {
          input: [
            { auto: true },
            '!src/prisma/prisma-client',
            '!src/prisma/prisma-client/**',
            '!src/prisma/pothos-types.ts',
          ],
          output: ['src/prisma/prisma-client/**', 'src/prisma/pothos-types.ts'],
        },
        command: 'prisma generate',
      },
      'dev:setup': {
        command: ['vp run db:generate', 'vp run generate-graphql'],
      },
      'generate-graphql': {
        cache: {
          input: [
            { auto: true },
            '!src/graphql/schema.graphql',
            '!src/graphql/schemaImportMap.tsx',
          ],
          output: ['src/graphql/schema.graphql', 'src/graphql/schemaImportMap.tsx'],
        },
        command:
          'node --no-warnings --experimental-specifier-resolution=node --import @oxc-node/core/register ./scripts/generate-graphql.tsx',
      },
      'test:all': {
        command: 'vp check && vp test',
      },
    },
  },
  staged: {
    '*': 'vp check --fix',
  },
});
