import { join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { voidReact } from '@void/react/plugin';
import dotenv from 'dotenv';
import { fate } from 'react-fate/vite';
import type { PluginOption } from 'vite-plus';
import { defineConfig, lazyPlugins } from 'vite-plus';
import { voidPlugin } from 'void';

const root = import.meta.dirname;
const isDevelopment = process.env.NODE_ENV === 'development' || process.env.DEV;

dotenv.config({
  path: join(root, '../server-prisma', isDevelopment ? '.env' : '.prod.env'),
  quiet: true,
});

if (!process.env.VITE_SERVER_URL) {
  throw new Error(`client-build, vite.config: 'VITE_SERVER_URL' is missing.`);
}

const lazyClientPlugins = (): Array<PluginOption> => [
  tailwindcss() as PluginOption,
  voidPlugin() as PluginOption,
  voidReact() as PluginOption,
  react({ compiler: true }) as PluginOption,
];

export default defineConfig({
  build: { outDir: join(root, '../dist/client') },
  cacheDir: join(root, 'node_modules/.vite/default'),
  plugins: [
    ...(lazyPlugins(lazyClientPlugins) ?? []),
    fate({
      module: '@nkzw/fate-server/src/trpc/router.ts',
    }),
  ],
  resolve: { conditions: ['@nkzw/source'] },
  server: { port: 6001 },
});
