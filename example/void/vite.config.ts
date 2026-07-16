import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { reactCompilerPreset } from '@vitejs/plugin-react';
import { voidReact } from '@void/react/plugin';
import { fate } from 'react-fate/vite';
import type { PluginOption } from 'vite-plus';
import { defineConfig, lazyPlugins } from 'vite-plus';
import { voidPlugin } from 'void';

const lazyVoidPlugins = (): Array<PluginOption> => [
  babel({
    presets: [reactCompilerPreset()],
  }) as PluginOption,
  tailwindcss() as PluginOption,
  voidPlugin() as PluginOption,
  voidReact() as PluginOption,
];

export default defineConfig({
  environments: {
    void_worker: {
      optimizeDeps: {
        include: [
          '@nkzw/core/safeParse.js',
          '@nkzw/stack',
          '@radix-ui/react-slot',
          '@void/react',
          '@void/react/pages-server',
          'better-auth',
          'better-auth/adapters/drizzle',
          'better-auth/plugins',
          'class-variance-authority',
          'clsx',
          'drizzle-orm',
          'lucide-react',
          'react',
          'react-error-boundary',
          'react/jsx-dev-runtime',
          'react/jsx-runtime',
          'tailwind-merge',
          'void/schema-d1',
          'zod',
        ],
      },
    },
  },
  plugins: [
    ...(lazyPlugins(lazyVoidPlugins) ?? []),
    fate({
      module: './src/fate/server.ts',
      transport: 'void',
    }),
  ],
  resolve: { conditions: ['@nkzw/source'] },
  server: { port: 6001 },
  ssr: { noExternal: ['void-fate'] },
});
