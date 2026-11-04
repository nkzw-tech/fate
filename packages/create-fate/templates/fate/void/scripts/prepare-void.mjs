import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

// Void loads auth.ts through Vite before generating the tsconfig it extends.
// Bootstrap clean checkouts without overwriting existing generated settings.
if (!existsSync('.void/tsconfig.json')) {
  mkdirSync('.void', { recursive: true });
  writeFileSync('.void/tsconfig.json', '{}\n');
}
