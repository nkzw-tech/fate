/* __PATH_IMPORT__ */
import nkzw from '@nkzw/oxlint-config/with-sorting';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { voidVue } from '@void/vue/plugin';
/* __DOTENV_IMPORT__ */
import { defineConfig, lazyPlugins } from 'vite-plus';
import { voidPlugin } from 'void';
import { fate } from 'vue-fate/vite';

/* __ENV_CONFIG__ */

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST;

export default defineConfig({
  /* __BUILD_CONFIG__ */
  environments: {
    void_worker: {
      optimizeDeps: {
        // Discover page and API dependencies before the first request triggers hydration.
        entries: ['pages/**/*.vue', 'routes/**/*.ts'],
        // Keep SSR and component dependencies on the same Vue runtime from the first request.
        include: ['vue', 'vue/server-renderer'],
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
    ignorePatterns: [
      '**/.cloudflare/**',
      '.fate/',
      '.void/',
      /* __WRANGLER_IGNORE__ */
      'dist/',
      'node_modules/',
      /* __PARENT_DIST_FMT__ */
      'pnpm-lock.yaml',
    ],
    singleQuote: true,
  },
  lint: {
    extends: [nkzw],
    ignorePatterns: [
      '**/.cloudflare/**',
      '.fate',
      '.void',
      /* __WRANGLER_IGNORE__ */
      'dist',
      'node_modules',
      /* __PARENT_DIST_LINT__ */
      'vite.config.ts.timestamp-*',
    ],
    options: { typeCheck: true },
    overrides: [
      {
        env: { browser: true },
        files: ['**/*.vue'],
        globals: {
          defineEmits: 'readonly',
          defineExpose: 'readonly',
          defineModel: 'readonly',
          defineOptions: 'readonly',
          defineProps: 'readonly',
          defineSlots: 'readonly',
          withDefaults: 'readonly',
        },
      },
      {
        files: ['db/seed.ts', '**/__tests__/**'],
        rules: {
          'no-console': 'off',
        },
      },
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  optimizeDeps: {
    exclude: ['@nkzw/fate/client', 'vue-fate/client'],
  },
  plugins: [
    ...(lazyPlugins(() => [tailwindcss(), ...(isTest ? [vue()] : [voidPlugin(), voidVue()])]) ??
      []),
    fate({
      module: '__FATE_MODULE__',
      /* __FATE_TRANSPORT__ */
    }),
  ],
  server: { port: 6001 },
  ssr: { noExternal: ['@nkzw/fate', 'vue-fate'] },
  staged: {
    '*': 'vp check --fix',
  },
  test: {
    passWithNoTests: true,
  },
});
