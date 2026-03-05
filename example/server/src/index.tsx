#!/usr/bin/env NODE_ENV=development node_modules/.bin/nodemon -q -I --exec node --no-warnings --experimental-specifier-resolution=node --loader ts-node/esm --env-file .env
import { parseArgs, styleText } from 'node:util';
import { serve } from '@hono/node-server';
import { trpcServer } from '@hono/trpc-server';
import parseInteger from '@nkzw/core/parseInteger.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { auth } from './lib/auth.tsx';
import env from './lib/env.ts';
import prisma from './prisma/prisma.tsx';
import { createContext } from './trpc/context.ts';
import { appRouter } from './trpc/router.ts';

try {
  await prisma.$connect();
} catch (error) {
  console.error(`${styleText(['red', 'bold'], 'Prisma Database Connection Error')}\n`, error);
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

const origin = env('CLIENT_DOMAIN');
const port = (portArg && parseInteger(portArg)) || 9020;
const app = new Hono();

app.use(
  cors({
    credentials: true,
    origin,
  }),
);

app.use(
  '/trpc/*',
  trpcServer({
    createContext: (_, context) => createContext({ context }),
    router: appRouter,
  }),
);

app.on(['POST', 'GET'], '/api/auth/*', ({ req }) => auth.handler(req.raw));

app.all('/*', (context) => context.redirect(origin));

serve({ fetch: app.fetch, port }, () =>
  console.log(
    `${styleText(['green', 'bold'], ` ➜`)} Server running on port ${styleText('bold', String(port))}.\n`,
  ),
);
