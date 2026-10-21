import { defineConfig } from 'vite-plus';

export default defineConfig({
  run: {
    tasks: {
      build: {
        cache: {
          // Ignore the package listing so deleting lib still allows cache restoration.
          input: [{ auto: true }, '!.', '!lib', '!lib/**'],
          output: ['lib/**'],
        },
        command:
          'vp pack --tsconfig tsconfig.json -d lib --target=node24 src/index.ts src/client.ts src/cli.ts src/vite.ts',
      },
    },
  },
});
