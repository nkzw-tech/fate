import { defineConfig } from 'drizzle-kit';
import env from './src/lib/env.ts';

export default defineConfig({
  dbCredentials: {
    url: env('DATABASE_URL'),
  },
  dialect: 'postgresql',
  out: './src/drizzle/migrations',
  schema: './src/drizzle/schema.ts',
});
