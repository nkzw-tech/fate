import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: ['./src/app.tsx'],
    outputOptions: { file: 'dist/index.js' },
  },
});
