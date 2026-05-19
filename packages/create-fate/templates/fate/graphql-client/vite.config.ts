import nkzw from '@nkzw/oxlint-config';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { reactCompilerPreset } from '@vitejs/plugin-react';
import { voidReact } from '@void/react/plugin';
import { fate } from 'react-fate/vite';
import { defineConfig, lazyPlugins } from 'vite-plus';
import { voidPlugin } from 'void';

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST;

export default defineConfig({
  optimizeDeps: {
    exclude: ['@nkzw/fate/client', 'react-fate/client'],
  },
  environments: {
    void_worker: {
      optimizeDeps: {
        exclude: [
          '@nkzw/fate',
          '@nkzw/fate/client',
          '@nkzw/fate/server',
          '@void/react',
          '@void/react/pages-server',
          'lucide-react',
          'react-error-boundary',
          'react-fate',
          'react-fate/client',
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
        files: ['src/fate/graphql.ts'],
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
      babel({
        presets: [reactCompilerPreset()],
      }),
      tailwindcss(),
      ...(isTest ? [] : [voidPlugin(), voidReact()]),
    ]) ?? []),
    fate({
      module: './src/fate/graphql.ts',
      transport: 'graphql',
    }),
  ],
  run: {
    tasks: {
      'test:all': {
        command: 'vp check && vp test',
      },
    },
  },
  server: { port: 6001 },
  ssr: { noExternal: ['@nkzw/fate', 'react-fate'] },
  staged: {
    '*': 'vp check --fix',
  },
});
