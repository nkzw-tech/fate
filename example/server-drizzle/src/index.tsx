#!/usr/bin/env NODE_ENV=development OXC_TSCONFIG_PATH=../../tsconfig.json node_modules/.bin/nodemon -q -I --exec node --no-warnings --experimental-specifier-resolution=node --import @oxc-node/core/register --env-file .env
import { parseArgs, styleText } from 'node:util';
import { serve } from '@hono/node-server';
import { trpcServer } from '@hono/trpc-server';
import parseInteger from '@nkzw/core/parseInteger.js';
import { createHonoFateHandler } from '@nkzw/fate/server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { connectDatabase } from './drizzle/db.ts';
import { auth } from './lib/auth.tsx';
import { clientOrigin, resolveCorsOrigin } from './lib/origins.ts';
import { createContext } from './trpc/context.ts';
import { fateServer } from './trpc/init.ts';
import { appRouter } from './trpc/router.ts';

try {
  await connectDatabase();
} catch (error) {
  console.error(`${styleText(['red', 'bold'], 'Drizzle Database Connection Error')}\n`, error);
  process.exit(1);
}

const {
  values: { port: portArg },
} = parseArgs({
  options: {
    port: {
      default: '9020',
      short: 'p',
      type: 'string',
    },
  },
});

const port = (portArg && parseInteger(portArg)) || 9020;
const app = new Hono();

app.use(
  cors({
    credentials: true,
    origin: resolveCorsOrigin,
  }),
);

app.use(
  '/trpc/*',
  trpcServer({
    createContext: (_, context) => createContext({ context }),
    router: appRouter,
  }),
);

app.all('/fate/*', createHonoFateHandler(fateServer));

app.on(['POST', 'GET'], '/api/auth/*', ({ req }) => auth.handler(req.raw));

app.all('/*', (context) => context.redirect(clientOrigin));

serve({ fetch: app.fetch, port }, () =>
  console.log(
    `${styleText(['green', 'bold'], ` ➜`)} Server running on port ${styleText('bold', String(port))}.\n`,
  ),
);
