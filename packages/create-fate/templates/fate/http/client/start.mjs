import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const dist = new URL('./dist/', import.meta.url);
// Void's Node renderer reads this manifest to emit client scripts and styles.
globalThis.__VITE_MANIFEST__ = JSON.parse(
  readFileSync(new URL('client/.vite/manifest.json', dist), 'utf8'),
);
process.chdir(fileURLToPath(dist));
await import(new URL('ssr/index.js', dist).href);
