import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const template = join(root, 'packages/create-fate/templates/fate/client-only');
const exampleDependencies = join(root, 'example/void/node_modules');
const workspacePackages = {
  '@nkzw/fate': 'fate',
  '@nkzw/fate-indexeddb': 'fate-indexeddb',
  'react-fate': 'react-fate',
};
const { dependencies } = JSON.parse(await readFile(join(template, 'package.json'), 'utf8'));
const app = await mkdtemp(join(tmpdir(), 'fate-client-only-'));

try {
  await cp(template, app, { recursive: true });
  // Use the workspace build and the Void example's installed runtime dependencies.
  for (const name of [...Object.keys(dependencies), 'vite', 'vite-plus']) {
    const workspacePackage = workspacePackages[name];
    const source = workspacePackage
      ? join(root, 'packages', workspacePackage)
      : join(exampleDependencies, name);
    const destination = join(app, 'node_modules', name);
    await mkdir(dirname(destination), { recursive: true });
    await symlink(source, destination, 'junction');
  }

  const server = spawn('vp', ['dev', '--port', '6011', '--strictPort'], {
    cwd: app,
    stdio: 'inherit',
  });
  process.once('SIGINT', () => server.kill('SIGINT'));
  process.once('SIGTERM', () => server.kill('SIGTERM'));
  const [code] = await once(server, 'exit');
  process.exitCode = code ?? 0;
} finally {
  await rm(app, { force: true, recursive: true });
}
