import { getSession } from 'void/auth';
import { db } from 'void/db';
import { toSessionUser } from '../user/SessionUser.tsx';

export const createContext = async ({ request }: { request: Request }) => {
  const session = getSession();

  return {
    db,
    headers: request.headers,
    sessionUser: session?.user ? toSessionUser(session.user) : null,
  };
};

export type AppContext = Awaited<ReturnType<typeof createContext>>;
