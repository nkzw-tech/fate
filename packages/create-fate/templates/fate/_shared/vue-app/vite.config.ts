import { join } from 'node:path';
import nkzw from '@nkzw/oxlint-config';
import tailwindcss from '@tailwindcss/vite';
import { voidVue } from '@void/vue/plugin';
import dotenv from 'dotenv';
import { defineConfig, lazyPlugins } from 'vite-plus';
import { voidPlugin } from 'void';
import { fate } from 'vue-fate/vite';

const root = process.cwd();
__DOTENV_CONFIG__;

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
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  plugins: [
    ...(lazyPlugins(() => [tailwindcss(), voidPlugin(), voidVue()]) ?? []),
    fate({
      module: '__FATE_MODULE__',
      /* __FATE_TRANSPORT__ */
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
  ssr: { noExternal: ['@nkzw/fate', 'vue-fate'] },
  staged: {
    '*': 'vp check --fix',
  },
});
