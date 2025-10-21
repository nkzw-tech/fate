import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import nkzw from '@nkzw/eslint-config';

export default [
  ...nkzw,
  {
    ignores: [
      'dist',
      'packages/**/lib',
      'server/src/prisma/pothos-types.ts',
      'server/src/prisma/prisma-client/*',
    ],
  },
  {
    files: [
      './server/scripts/**/*.tsx',
      './server/src/index.tsx',
      './server/src/prisma/seed.tsx',
    ],
    rules: {
      'no-console': 0,
    },
  },
  {
    files: ['server/**/*.tsx'],
    rules: {
      'react-hooks/rules-of-hooks': 0,
    },
  },
  {
    rules: {
      '@typescript-eslint/array-type': [2, { default: 'generic' }],
      'import-x/no-extraneous-dependencies': [
        2,
        {
          devDependencies: [
            './client/vite.config.ts',
            './eslint.config.js',
            './server/prisma.config.ts',
            './server/scripts/**/*.tsx',
            '**/__tests__/**',
            '**/tsdown.config.js',
            'vitest.config.ts',
          ],
          packageDir: [import.meta.dirname].concat(
            readFileSync('./pnpm-workspace.yaml', 'utf8')
              .split('\n')
              .slice(1)
              .map((n) =>
                join(
                  import.meta.dirname,
                  n
                    .replaceAll(/\s*-\s+/g, '')
                    .replaceAll("'", '')
                    .replaceAll('\r', ''),
                ),
              ),
          ),
        },
      ],
    },
  },
];
