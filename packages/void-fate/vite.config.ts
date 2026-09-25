import { defineConfig } from 'vite-plus';

export default defineConfig({
  run: {
    tasks: {
      build: {
        command:
          'vp pack --tsconfig tsconfig.json -d lib --target=node24 src/index.ts src/react.tsx src/server.ts',
      },
    },
  },
});
