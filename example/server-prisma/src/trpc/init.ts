import { initTRPC } from '@trpc/server';
import type { AppContext } from './context.ts';

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const procedure = t.procedure;
export const middleware = t.middleware;
