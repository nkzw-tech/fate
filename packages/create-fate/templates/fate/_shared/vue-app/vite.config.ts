import nkzw from '@nkzw/oxlint-config';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { voidVue } from '@void/vue/plugin';
import { defineConfig, lazyPlugins } from 'vite-plus';
import { voidPlugin } from 'void';
import { fate } from 'vue-fate/vite';

/* __ENV_CONFIG__ */

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST;

export default defineConfig({
  /* __BUILD_CONFIG__ */
  optimizeDeps: {
    exclude: ['@nkzw/fate/client', 'vue-fate/client'],
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
    ignorePatterns: __FMT_IGNORE_PATTERNS__,
    singleQuote: true,
  },
  lint: {
    extends: [nkzw],
    ignorePatterns: __LINT_IGNORE_PATTERNS__,
    options: { typeAware: true, typeCheck: true },
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
