import nkzw from '@nkzw/oxlint-config';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { voidReact } from '@void/react/plugin';
import { fate } from 'react-fate/vite';
import { defineConfig, lazyPlugins } from 'vite-plus';
import { voidPlugin } from 'void';

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST;

export default defineConfig({
  optimizeDeps: {
    exclude: ['@nkzw/fate/client', 'react-fate/client', 'void-fate/react'],
  },
  environments: {
    void_worker: {
      optimizeDeps: {
        exclude: [
          '@nkzw/fate/client',
          '@nkzw/fate/server',
          '@nkzw/stack',
          '@radix-ui/react-slot',
          '@void/react',
          '@void/react/pages-server',
          'lucide-react',
          'react-error-boundary',
          'react-fate',
          'react-fate/client',
          'void-fate/react',
          'void-fate/server',
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
    extends: [nkzw],
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
    ...(lazyPlugins(() => [
      tailwindcss(),
      ...(isTest ? [] : [voidPlugin(), voidReact()]),
      react({ compiler: true }),
    ]) ?? []),
    fate({
      module: './src/fate/server.ts',
      transport: 'void',
    }),
  ],
  server: { port: 6001 },
  ssr: { noExternal: ['void-fate'] },
  staged: {
    '*': 'vp check --fix',
  },
});
