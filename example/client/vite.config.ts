import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import reactCompiler from 'babel-plugin-react-compiler';
import dotenv from 'dotenv';
import { join } from 'node:path';
import { defineConfig } from 'vite';

const root = process.cwd();
const isDevelopment = process.env.NODE_ENV === 'development' || process.env.DEV;

dotenv.config({
  path: join(root, '../server', isDevelopment ? '.env' : '.prod.env'),
  quiet: true,
});

if (!process.env.VITE_SERVER_URL) {
  throw new Error(`client-build, vite.config: 'VITE_SERVER_URL' is missing.`);
}

export default defineConfig({
  build: { outDir: join(root, '../dist/client') },
  plugins: [
    tailwindcss(),
    react({
      babel: {
        plugins: [reactCompiler],
      },
    }),
  ],
  resolve: {
    alias: {
      '@nkzw/fate': join(root, '../../packages/fate/src/index.ts'),
      'react-fate': join(root, '../../packages/react-fate/src/index.tsx'),
    },
  },
  server: { port: 6001 },
});
