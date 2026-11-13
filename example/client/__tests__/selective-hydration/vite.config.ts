import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  plugins: [
    {
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (request.url !== '/') {
            return next();
          }
          try {
            const template = await readFile(new URL('./index.html', import.meta.url), 'utf8');
            const { render } = (await server.ssrLoadModule(
              '/server.tsx',
            )) as typeof import('./server.tsx');
            const { html, state } = await render();
            const document = await server.transformIndexHtml('/', template);
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end(
              document.replace('<!--app-->', () => html).replace('<!--state-->', () => state),
            );
          } catch (error) {
            if (error instanceof Error) {
              server.ssrFixStacktrace(error);
            }
            next(error);
          }
        });
      },
      name: 'fate-selective-hydration-fixture',
    },
  ],
  root: import.meta.dirname,
  server: { port: 6013, strictPort: true },
});
