import { voidReact } from '@void/react/plugin';
import { defineConfig } from 'vite-plus';
import { voidPlugin } from 'void';

export default defineConfig({
  fmt: { ignorePatterns: ['.void/', 'dist/', 'pnpm-lock.yaml'], singleQuote: true },
  lint: {
    ignorePatterns: ['.void/', 'dist/'],
    options: { typeAware: true, typeCheck: true },
  },
  plugins: [voidPlugin(), voidReact()],
});
