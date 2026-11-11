import { createServer } from 'vite';
import { expect, test } from 'vite-plus/test';
import { fateDevtools } from '../vite.ts';

test(`'fateDevtools' serves the panel and rejects malformed paths`, async () => {
  const server = await createServer({
    configFile: false,
    plugins: [fateDevtools()],
    server: { host: '127.0.0.1', port: 0 },
  });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing server address');
    }
    const base = `http://127.0.0.1:${address.port}/__fate-devtools/`;
    expect((await fetch(`${base}%E0%A4%A`)).status).toBe(400);
    expect((await fetch(`${base}..%2fpackage.json`)).status).toBe(403);
    const response = await fetch(base);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('<div id="root">');
  } finally {
    await server.close();
  }
});
