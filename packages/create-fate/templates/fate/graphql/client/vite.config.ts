import { join } from 'node:path';
import fbtee from '@nkzw/vite-plugin-fbtee';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { voidReact } from '@void/react/plugin';
import dotenv from 'dotenv';
import { fate } from 'react-fate/vite';
import { defineConfig, lazyPlugins } from 'vite-plus';
import { voidPlugin } from 'void';

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
    ...(lazyPlugins(() => [
      fbtee(),
      tailwindcss(),
      voidPlugin(),
      voidReact(),
      react({ compiler: true }),
    ]) ?? []),
    fate({
      module: '@app/server/src/graphql/fate.ts',
      transport: 'graphql',
    }),
  ],
});
