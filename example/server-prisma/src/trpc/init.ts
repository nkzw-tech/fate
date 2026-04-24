import { createPrismaFate } from '@nkzw/fate/server/prisma';
import { initTRPC } from '@trpc/server';
import type { AppContext } from './context.ts';
import { Root } from './views.ts';

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const procedure = t.procedure;
export const middleware = t.middleware;

export const fate = createPrismaFate<AppContext, typeof procedure>({
  procedure,
  views: Root,
});
