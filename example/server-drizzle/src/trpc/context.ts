import type { Context } from 'hono';
import db from '../drizzle/db.ts';
import { auth } from '../lib/auth.tsx';
import { toSessionUser } from '../user/SessionUser.tsx';

type CreateContextOptions = {
  context: Context;
};

export const createContext = async (options?: CreateContextOptions) => {
  const session = options
    ? await auth.api.getSession({ headers: options.context.req.raw.headers })
    : null;

  return {
    db,
    headers: options ? options.context.req.raw.headers : {},
    sessionUser: session?.user ? toSessionUser(session.user) : null,
  };
};

export type AppContext = Awaited<ReturnType<typeof createContext>>;
