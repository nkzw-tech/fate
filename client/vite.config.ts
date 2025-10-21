import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import reactCompiler from 'babel-plugin-react-compiler';
import dotenv from 'dotenv';
import { defineConfig } from 'vite';

const root = process.cwd();

dotenv.config({
  path: join(
    root,
    '../server',
    process.env.NODE_ENV === 'development' || process.env.DEV
      ? '.env'
      : '.prod.env',
  ),
  quiet: true,
});

if (!process.env.VITE_SERVER_URL) {
  throw new Error(`client-build, vite.config: 'VITE_SERVER_URL' is missing.`);
}

export default defineConfig({
  build: { outDir: join(root, '../dist/client') },
  plugins: [
    react({
      babel: {
        plugins: [reactCompiler],
      },
    }),
  ],
  server: { port: 6001 },
});
