import tailwindcss from '@tailwindcss/vite';
import { voidReact } from '@void/react/plugin';
import { fate } from 'react-fate/vite';
import { defineConfig } from 'vite-plus';
import { voidPlugin } from 'void';

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
    tailwindcss(),
    voidPlugin(),
    voidReact(),
    fate({
      module: './src/fate/server.ts',
      transport: 'native',
    }),
  ],
  resolve: { conditions: ['@nkzw/source'] },
  server: { port: 6001 },
});
