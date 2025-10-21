import { join } from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'vitest/config';

const root = process.cwd();

dotenv.config({
  path: join(root, './server', '.env'),
  quiet: true,
});

export default defineConfig({});
