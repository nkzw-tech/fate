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
          'vp pack --tsconfig tsconfig.json -d lib --target=node24 src/index.ts src/clientStub.ts src/list.ts src/cli.ts src/server.ts src/server/drizzle.ts src/server/prisma.ts src/graphqlTransport.ts src/vite.ts src/persistence.ts src/idempotency.ts',
      },
    },
  },
});
