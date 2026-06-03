import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: ['./src/app.tsx'],
    outputOptions: { codeSplitting: false, entryFileNames: 'index.js' },
  },
});
