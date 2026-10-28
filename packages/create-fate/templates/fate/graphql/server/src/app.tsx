import { styleText } from 'node:util';
import { useDeferStream as createGraphQLDeferPlugin } from '@graphql-yoga/plugin-defer-stream';
import { useGraphQLSSE as createGraphQLSSEPlugin } from '@graphql-yoga/plugin-graphql-sse';
import { createYoga } from 'graphql-yoga';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Context, createContext } from './graphql/context.tsx';
import schema from './graphql/schema.tsx';
import { auth } from './lib/auth.tsx';
import { clientOrigin, resolveCorsOrigin } from './lib/origins.ts';
import prisma from './prisma/prisma.tsx';

try {
  await prisma.$connect();
} catch (error) {
  console.error(`${styleText(['red', 'bold'], 'Prisma Database Connection Error')}\n`, error);
  process.exit(1);
}

const app = new Hono();

app.use(
  cors({
    credentials: true,
    origin: resolveCorsOrigin,
  }),
);

app.on(['POST', 'GET'], '/api/auth/*', ({ req }) => auth.handler(req.raw));

const yoga = createYoga<Context>({
  graphiql: process.env.NODE_ENV === 'development',
  plugins: [
    createGraphQLDeferPlugin(),
    createGraphQLSSEPlugin({
      endpoint: '/graphql/stream',
    }),
  ],
  schema,
});

app.on(['POST', 'GET', 'OPTIONS', 'DELETE', 'PUT'], '/graphql/*', async (context) => {
  const req = context.req.raw;
  return yoga.handleRequest(req, await createContext({ headers: req.headers }));
});

app.all('/*', (context) => context.redirect(clientOrigin));

export default app;
