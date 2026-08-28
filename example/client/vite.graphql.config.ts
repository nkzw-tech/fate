import { join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { voidReact } from '@void/react/plugin';
import dotenv from 'dotenv';
import { fate } from 'react-fate/vite';
import type { PluginOption } from 'vite';
import { defineConfig, lazyPlugins } from 'vite-plus';
import { voidPlugin } from 'void';

const root = import.meta.dirname;
const isDevelopment = process.env.NODE_ENV === 'development' || process.env.DEV;

dotenv.config({
  path: join(root, '../server-graphql', isDevelopment ? '.env' : '.prod.env'),
  quiet: true,
});

if (!process.env.VITE_SERVER_URL) {
  throw new Error(`client-build, vite.graphql.config: 'VITE_SERVER_URL' is missing.`);
}

process.env.VITE_FATE_TRANSPORT = 'graphql';

const lazyClientPlugins = (): Array<PluginOption> => [
  tailwindcss() as PluginOption,
  voidPlugin() as PluginOption,
  voidReact() as PluginOption,
  react({ compiler: true }) as PluginOption,
];

export default defineConfig({
  build: { outDir: join(root, '../dist/client') },
  cacheDir: join(root, 'node_modules/.vite/graphql'),
  plugins: [
    ...(lazyPlugins(lazyClientPlugins) ?? []),
    fate({
      module: '@nkzw/fate-server-graphql/src/graphql/fate.ts',
      transport: 'graphql',
    }),
  ],
  resolve: { conditions: ['@nkzw/source'] },
  server: { port: 6001 },
});
