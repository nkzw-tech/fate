import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite-plus';

const root = import.meta.dirname;

export default defineConfig({
  base: './',
  build: {
    emptyOutDir: true,
    outDir: fileURLToPath(new URL('../lib/panel', import.meta.url)),
    reportCompressedSize: false,
  },
  resolve: { conditions: ['@nkzw/source'] },
  root,
});
