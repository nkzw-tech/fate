import { createLiveEventBus } from '@nkzw/fate/server';
import { createDrizzleFate } from '@nkzw/fate/server/drizzle';
import { initTRPC } from '@trpc/server';
import db from '../drizzle/db.ts';
import schema from '../drizzle/schema.ts';
import type { AppContext } from './context.ts';
import { Root } from './views.ts';

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const procedure = t.procedure;
export const middleware = t.middleware;
export const live = createLiveEventBus();

export const fate = createDrizzleFate<AppContext, typeof procedure>({
  db,
  procedure,
  schema,
  views: Root,
});
