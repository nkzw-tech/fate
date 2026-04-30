import { createFateServer, createLiveEventBus } from '@nkzw/fate/server';
import { createPrismaFate } from '@nkzw/fate/server/prisma';
import { initTRPC } from '@trpc/server';
import type { Context } from 'hono';
import type { AppContext } from './context.ts';
import { Root } from './views.ts';

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const procedure = t.procedure;
export const middleware = t.middleware;
export const live = createLiveEventBus();

export const fate = createPrismaFate<AppContext, typeof procedure>({
  procedure,
  views: Root,
});

export const fateServer = createFateServer<AppContext>({
  context: async ({ adapterContext }) => {
    const { createContext } = await import('./context.ts');
    return createContext({ context: adapterContext as Context });
  },
  live,
  queries: {
    viewer: {
      resolve: ({
        ctx,
        input,
      }: {
        ctx: AppContext;
        input: { args?: Record<string, unknown>; select: Array<string> };
      }) =>
        ctx.sessionUser
          ? fate.resolveById({
              ctx,
              id: ctx.sessionUser.id,
              input,
              view: Root.viewer,
            })
          : null,
    },
  },
  roots: Root,
  sources: fate,
});
