import { join } from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

const root = process.cwd();
dotenv.config({
  path: join(root, '.env'),
  quiet: true,
});

const { default: env } = await import('./src/lib/env.ts');

export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    seed: `node --no-warnings --experimental-specifier-resolution=node --loader ts-node/esm --env-file .env src/prisma/seed.tsx`,
  },
  schema: './src/prisma/schema.prisma',
});
