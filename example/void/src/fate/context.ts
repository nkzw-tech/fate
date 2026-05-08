import { db } from 'void/db';
import { getAuthSession } from '../lib/auth.ts';
import { toSessionUser } from '../user/SessionUser.tsx';

export const createContext = async ({ request }: { request: Request }) => {
  const session = await getAuthSession(request);

  return {
    db,
    headers: request.headers,
    sessionUser: session?.user ? toSessionUser(session.user) : null,
  };
};

export type AppContext = Awaited<ReturnType<typeof createContext>>;
