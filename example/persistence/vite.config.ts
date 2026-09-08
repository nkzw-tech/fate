import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite-plus';
import { createBackend } from './server.ts';

export default defineConfig({
  plugins: [
    tailwindcss(),
    {
      configureServer(server) {
        const directory = new URL('./.data/', import.meta.url);
        mkdirSync(directory, { recursive: true });
        const backend = createBackend(fileURLToPath(new URL('notes.sqlite', directory)));
        server.httpServer?.once('close', backend.close);
        server.middlewares.use('/api/fate', async (req, res) => {
          try {
            const chunks = [];
            for await (const chunk of req) {
              chunks.push(Buffer.from(chunk));
            }
            const headers = new Headers();
            for (const [key, value] of Object.entries(req.headers)) {
              if (value) {
                headers.set(key, Array.isArray(value) ? value.join(',') : value);
              }
            }
            const response = await backend.handleRequest(
              new Request('http://localhost/api/fate', {
                body: Buffer.concat(chunks).toString(),
                headers,
                method: 'POST',
              }),
            );
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(await response.text());
          } catch {
            res.writeHead(500);
            res.end('Request failed');
          }
        });
      },
      name: 'fate-persistence-server',
    },
  ],
  resolve: { conditions: ['@nkzw/source'] },
  server: { port: 6010, strictPort: true },
});
