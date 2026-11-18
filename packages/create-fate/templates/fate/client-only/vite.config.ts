import nkzw from '@nkzw/oxlint-config/with-sorting';
import { voidReact } from '@void/react/plugin';
import { defineConfig } from 'vite-plus';
import { voidPlugin } from 'void';

export default defineConfig({
  fmt: { ignorePatterns: ['.void/', 'dist/', 'pnpm-lock.yaml'], singleQuote: true },
  lint: {
    extends: [nkzw],
    ignorePatterns: ['.void/', 'dist/'],
    options: { typeCheck: true },
  },
  plugins: [voidPlugin(), voidReact()],
});
