import type { Context } from 'hono';
import { auth } from '../lib/auth.ts';
import prisma from '../prisma/prisma.ts';
import { toSessionUser } from '../user/SessionUser.tsx';

type CreateContextOptions = {
  context: Context;
};

export const createContext = async (options?: CreateContextOptions) => {
  const session = options
    ? await auth.api.getSession({ headers: options.context.req.raw.headers })
    : null;

  return {
    headers: options ? options.context.req.raw.headers : {},
    prisma,
    sessionUser: session?.user ? toSessionUser(session.user) : null,
  };
};

export type AppContext = Awaited<ReturnType<typeof createContext>>;
