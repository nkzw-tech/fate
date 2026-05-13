import tailwindcss from '@tailwindcss/vite';
import { voidReact } from '@void/react/plugin';
import { fate } from 'react-fate/vite';
import { defineConfig } from 'vite-plus';
import { voidPlugin } from 'void';

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST;

export default defineConfig({
  environments: {
    void_worker: {
      optimizeDeps: {
        include: [
          '@nkzw/core/safeParse.js',
          '@nkzw/stack',
          '@radix-ui/react-slot',
          '@void/react',
          '@void/react/pages-server',
          'better-auth',
          'better-auth/adapters/drizzle',
          'better-auth/plugins',
          'class-variance-authority',
          'clsx',
          'drizzle-orm',
          'lucide-react',
          'react',
          'react-error-boundary',
          'react/jsx-dev-runtime',
          'react/jsx-runtime',
          'tailwind-merge',
          'void/schema-d1',
          'zod',
        ],
      },
    },
  },
  fmt: {
    experimentalSortImports: {
      newlinesBetween: false,
    },
    experimentalSortPackageJson: {
      sortScripts: true,
    },
    experimentalTailwindcss: {
      stylesheet: 'src/App.css',
    },
    ignorePatterns: ['.fate/', '.void/', 'dist/', 'node_modules/', 'pnpm-lock.yaml'],
    singleQuote: true,
  },
  lint: {
    ignorePatterns: ['.fate', '.void', 'dist', 'node_modules', 'vite.config.ts.timestamp-*'],
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        files: ['db/seed.ts', 'src/fate/__tests__/**'],
        rules: {
          'no-console': 'off',
        },
      },
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  plugins: [
    tailwindcss(),
    ...(isTest ? [] : [voidPlugin(), voidReact()]),
    fate({
      module: './src/fate/server.ts',
      transport: 'void',
    }),
  ],
  resolve: { conditions: ['@nkzw/source'] },
  server: { port: 6001 },
  ssr: { noExternal: ['void-fate'] },
});
