import db from '../drizzle/db.ts';
import { auth } from '../lib/auth.ts';
import { toSessionUser } from '../user/SessionUser.tsx';

type CreateContextOptions = {
  request: Request;
};

export const createContext = async (options?: CreateContextOptions) => {
  const headers = options?.request.headers;
  const session = headers ? await auth.api.getSession({ headers }) : null;

  return {
    db,
    headers: headers ?? {},
    sessionUser: session?.user ? toSessionUser(session.user) : null,
  };
};

export type AppContext = Awaited<ReturnType<typeof createContext>>;
