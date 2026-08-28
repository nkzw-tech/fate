import { join } from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

const root = process.cwd();

dotenv.config({
  path: join(root, '.env'),
  quiet: true,
});

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL.');
}

export default defineConfig({
  datasource: {
    url: databaseUrl,
  },
  migrations: {
    seed: `node --no-warnings --experimental-specifier-resolution=node --import @oxc-node/core/register --env-file .env src/prisma/seed.tsx`,
  },
  schema: './src/prisma/schema.prisma',
});
