import tailwindcss from '@tailwindcss/vite';
import { voidReact } from '@void/react/plugin';
import { fate } from 'react-fate/vite';
import type { PluginOption } from 'vite-plus';
import { defineConfig, lazyPlugins } from 'vite-plus';
import { voidPlugin } from 'void';

const lazyVoidPlugins = (): Array<PluginOption> => [
  tailwindcss() as PluginOption,
  voidPlugin() as PluginOption,
  voidReact({ react: { compiler: true } }) as PluginOption,
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
  run: {
    tasks: {
      build: {
        cache: {
          input: [
            { auto: true },
            '!.',
            '!.void',
            '!.void/**',
            '!.wrangler/deploy',
            '!.wrangler/deploy/**',
          ],
        },
        command: 'vp build',
      },
      'fate:generate': {
        cache: {
          input: [{ auto: true }, '!.', '!.fate', '!.fate/**', '!.void', '!.void/**'],
          output: ['.fate/**', '.void/**'],
        },
        command:
          'node --conditions=development --no-warnings --import @oxc-node/core/register ../../packages/fate/src/cli.ts generate',
      },
      'prepare:void': {
        cache: {
          input: [{ auto: true }, '!.', '!.void', '!.void/**'],
          output: ['.void/**'],
        },
        command: 'void prepare',
      },
    },
  },
  server: { port: 6001 },
  ssr: { noExternal: ['void-fate'] },
});
