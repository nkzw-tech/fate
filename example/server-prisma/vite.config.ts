import { defineConfig } from 'vite-plus';

export default defineConfig({
  run: {
    tasks: {
      'dev:setup': {
        cache: {
          input: [{ auto: true }, '!src/prisma/prisma-client', '!src/prisma/prisma-client/**'],
          output: ['src/prisma/prisma-client/**'],
        },
        command: 'prisma generate',
      },
    },
  },
});
