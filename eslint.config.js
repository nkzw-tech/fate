import workspaces from 'eslint-plugin-workspaces';
import nkzw from '@nkzw/eslint-config';
import findWorkspaces from '@nkzw/find-workspaces';

export default [
  ...nkzw,
  {
    ignores: [
      'dist',
      'coverage',
      'example/server/src/prisma/pothos-types.ts',
      'example/server/src/prisma/prisma-client/*',
      'packages/**/lib',
    ],
  },
  {
    files: [
      './example/server/scripts/**/*.tsx',
      './example/server/src/index.tsx',
      './example/server/src/prisma/seed.tsx',
      './packages/fate/src/cli.ts',
      '**/__tests__/**',
    ],
    rules: {
      'no-console': 0,
    },
  },
  {
    files: ['example/server/**/*.tsx'],
    rules: {
      'react-hooks/rules-of-hooks': 0,
    },
  },
  {
    plugins: { workspaces },
    rules: {
      '@typescript-eslint/array-type': [2, { default: 'generic' }],
      '@typescript-eslint/no-explicit-any': 0,
      'import-x/no-extraneous-dependencies': [
        2,
        {
          devDependencies: [
            './eslint.config.js',
            './example/client/vite.config.ts',
            './example/server/prisma.config.ts',
            './example/server/scripts/**/*.tsx',
            '**/__tests__/**',
            '**/tsdown.config.js',
            'vitest.config.ts',
          ],
          packageDir: findWorkspaces(import.meta.dirname),
        },
      ],
      'workspaces/no-absolute-imports': 2,
      'workspaces/no-relative-imports': 2,
    },
  },
];
