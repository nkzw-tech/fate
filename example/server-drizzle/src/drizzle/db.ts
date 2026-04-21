import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import env from '../lib/env.ts';
import schema from './schema.ts';

export const pool = new Pool({
  connectionString: env('DATABASE_URL'),
});

const db = drizzle({
  client: pool,
  schema,
});

export const connectDatabase = async () => {
  const client = await pool.connect();
  client.release();
};

export const closeDatabase = async () => pool.end();

export default db;

export type Database = typeof db;
