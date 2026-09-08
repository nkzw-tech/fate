import nkzw from '@nkzw/oxlint-config';
import { defineConfig, lazyPlugins } from 'vite-plus';

const optimizedDeps = [
  '@nkzw/stack',
  '@paper-design/shaders',
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
];

export default defineConfig({
  fmt: {
    experimentalSortImports: { newlinesBetween: false },
    experimentalSortPackageJson: { sortScripts: true },
    experimentalTailwindcss: { stylesheet: 'src/index.css' },
    ignorePatterns: ['.void/', 'dist/', 'pnpm-lock.yaml'],
    singleQuote: true,
  },
  lint: {
    env: { browser: true, builtin: true, es2024: true, node: true },
    extends: [nkzw],
    ignorePatterns: ['.void', 'dist', 'vite.config.ts.timestamp-*'],
    options: { typeAware: true, typeCheck: true },
  },
  optimizeDeps: { include: optimizedDeps },
  plugins: lazyPlugins(async () => {
    const [{ default: tailwindcss }, { voidReact }, { voidPlugin }] = await Promise.all([
      import('@tailwindcss/vite'),
      import('@void/react/plugin'),
      import('void'),
    ]);
    return [
      ...(voidPlugin() as Array<unknown>),
      ...(tailwindcss() as Array<unknown>),
      ...(voidReact({ react: { compiler: true } }) as Array<unknown>),
    ] as never;
  }),
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { port: 4006 },
  ssr: { optimizeDeps: { include: optimizedDeps } },
  staged: { '*': 'vp check --fix' },
});
