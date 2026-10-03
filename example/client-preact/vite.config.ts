import { join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import dotenv from 'dotenv';
import { fate } from 'preact-fate/vite';
import { defineConfig } from 'vite-plus';

const root = import.meta.dirname;
const isDevelopment = process.env.NODE_ENV === 'development' || process.env.DEV;

dotenv.config({
  path: join(root, '../server-prisma', isDevelopment ? '.env' : '.prod.env'),
  quiet: true,
});

if (!process.env.VITE_SERVER_URL) {
  throw new Error(`client-preact-build, vite.config: 'VITE_SERVER_URL' is missing.`);
}

export default defineConfig({
  build: { outDir: join(root, '../dist/client-preact') },
  // Compile JSX with oxc for Preact's automatic runtime (`preact/jsx-runtime`),
  // without `@preact/preset-vite` or `preact/compat`.
  oxc: { jsx: { importSource: 'preact', runtime: 'automatic' } },
  plugins: [
    tailwindcss(),
    fate({
      module: '@nkzw/fate-server/src/trpc/router.ts',
    }),
  ],
  resolve: { conditions: ['@nkzw/source'] },
  server: { port: 6003 },
});
