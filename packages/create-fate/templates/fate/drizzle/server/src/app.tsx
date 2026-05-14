#!/usr/bin/env NODE_ENV=development node_modules/.bin/nodemon -q -I --exec node --no-warnings --experimental-specifier-resolution=node --loader ts-node/esm --env-file .env
import { styleText } from 'node:util';
import { trpcServer } from '@hono/trpc-server';
import { createHonoFateHandler } from '@nkzw/fate/server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { connectDatabase } from './drizzle/db.ts';
import { auth } from './lib/auth.ts';
import { clientOrigin, resolveCorsOrigin } from './lib/origins.ts';
import { appRouter } from './router.ts';
import { createContext } from './trpc/context.ts';
import { fateServer } from './trpc/init.ts';

try {
  await connectDatabase();
} catch (error) {
  console.error(`${styleText(['red', 'bold'], 'Drizzle Database Connection Error')}\n`, error);
  process.exit(1);
}

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

export default app;
