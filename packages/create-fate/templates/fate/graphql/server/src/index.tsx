#!/usr/bin/env NODE_ENV=development node_modules/.bin/nodemon -q -I --exec node --no-warnings --experimental-specifier-resolution=node --import @oxc-node/core/register --env-file .env
import { parseArgs, styleText } from 'node:util';
import { serve } from '@hono/node-server';
import parseInteger from '@nkzw/core/parseInteger.js';
import app from './app.tsx';

const name = 'Pothos GraphQL Server';

const {
  values: { port: portArg },
} = parseArgs({
  options: {
    port: {
      default: '9000',
      short: 'p',
      type: 'string',
    },
  },
});

const port = (portArg && parseInteger(portArg)) || 9000;

// See https://github.com/honojs/node-server/issues/233
process.on('uncaughtException', (error) => {
  if (
    !(error instanceof Error) ||
    !error.message.includes('Invalid state: ReadableStream is already closed')
  ) {
    throw error;
  }
});

serve({ fetch: app.fetch, port }, () =>
  console.log(
    `${styleText(['green', 'bold'], `${name}\n  ➜`)}  Server running on port ${styleText('bold', String(port))}.\n`,
  ),
);

const setTitle = (title: string) => {
  process.title = title;
  if (process.stdout.isTTY) {
    process.stdout.write(`${String.fromCharCode(27)}]0;🚀 ${title}${String.fromCharCode(7)}`);
  }
};
setTimeout(() => setTitle(name), 0);
