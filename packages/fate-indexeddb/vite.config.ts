import { defineConfig } from 'vite-plus';

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: 'vp pack --tsconfig tsconfig.json -d lib src/index.ts',
      },
    },
  },
});
