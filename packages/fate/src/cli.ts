#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { styleText } from 'node:util';
import { resolveConfig } from 'vite';

const clientModuleId = '\0@nkzw/fate/client.ts';

const usage = (message?: string): never => {
  if (message) {
    process.stderr.write(`${styleText('red', message)}\n\n`);
  }

  process.stderr.write(
    `${styleText('bold', 'Usage:')} ${styleText('blue', 'fate generate')}

Generates fate client files from the fate plugin in ./vite.config.ts.
`,
  );
  process.exit(1);
};

const [command, ...args] = process.argv.slice(2);

if (command !== 'generate' || args.length > 0) {
  usage();
}

const configFile = path.join(process.cwd(), 'vite.config.ts');
const config = await resolveConfig({ configFile }, 'serve');
const plugin = config.plugins.find((candidate) => candidate.name === '@nkzw/fate');

const load = plugin?.load;
const loadContext = {};
const result =
  typeof load === 'function'
    ? await load.call(loadContext as never, clientModuleId)
    : typeof load?.handler === 'function'
      ? await load.handler.call(loadContext as never, clientModuleId)
      : null;

if (!plugin || result == null) {
  usage(`No fate plugin found in '${path.relative(process.cwd(), configFile)}'.`);
}

process.stdout.write(styleText('green', `  fate client generated.\n`));
