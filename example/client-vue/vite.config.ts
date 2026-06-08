import { join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import dotenv from 'dotenv';
import { defineConfig } from 'vite-plus';
import { fate } from 'vue-fate/vite';

const root = import.meta.dirname;
const isDevelopment = process.env.NODE_ENV === 'development' || process.env.DEV;

dotenv.config({
  path: join(root, '../server-prisma', isDevelopment ? '.env' : '.prod.env'),
  quiet: true,
});

if (!process.env.VITE_SERVER_URL) {
  throw new Error(`client-vue-build, vite.config: 'VITE_SERVER_URL' is missing.`);
}

export default defineConfig({
  build: { outDir: join(root, '../dist/client-vue') },
  plugins: [
    vue(),
    tailwindcss(),
    fate({
      module: '@nkzw/fate-server/src/trpc/router.ts',
    }),
  ],
  resolve: { conditions: ['@nkzw/source'] },
  server: { port: 6002 },
});
