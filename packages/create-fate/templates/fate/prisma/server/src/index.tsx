import { parseArgs, styleText } from 'node:util';
import { serve } from '@hono/node-server';
import parseInteger from '@nkzw/core/parseInteger.js';
import app from './app.tsx';

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

serve({ fetch: app.fetch, port }, () =>
  console.log(
    `${styleText(['green', 'bold'], ` ➜`)} Server running on port ${styleText('bold', String(port))}.\n`,
  ),
);
