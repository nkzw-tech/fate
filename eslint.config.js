import nkzw from '@nkzw/eslint-config';
import findWorkspaces from '@nkzw/find-workspaces';
import eslintPluginBetterTailwindCSS from 'eslint-plugin-better-tailwindcss';
import workspaces from 'eslint-plugin-workspaces';

export default [
  ...nkzw,
  {
    ignores: [
      '.vitepress/cache',
      '.vitepress/dist',
      'coverage',
      'dist',
      'example/client/src/fate.ts',
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
      './scripts/**',
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
    plugins: {
      'better-tailwindcss': eslintPluginBetterTailwindCSS,
      workspaces,
    },
    rules: {
      '@typescript-eslint/array-type': [2, { default: 'generic' }],
      '@typescript-eslint/no-explicit-any': 0,
      'better-tailwindcss/enforce-consistent-class-order': 2,
      'better-tailwindcss/no-conflicting-classes': 2,
      'import-x/no-extraneous-dependencies': [
        2,
        {
          devDependencies: [
            './.vitepress/**',
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
    settings: {
      'better-tailwindcss': {
        entryPoint: './example/client/src/App.css',
      },
    },
  },
];
