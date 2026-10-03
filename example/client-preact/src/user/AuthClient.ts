import { createAuthClient } from 'better-auth/client';
import { useEffect, useState } from 'preact/hooks';
import env from '../lib/env.ts';

const authClient = createAuthClient({
  baseURL: env('SERVER_URL'),
});

type Session = ReturnType<typeof authClient.useSession.get>;

/**
 * `better-auth/react`'s `useSession`, built on the vanilla client: there,
 * `useSession` is a nanostores atom. Subscribing also triggers the session
 * fetch on mount.
 */
function useSession(): Session {
  const [session, setSession] = useState(() => authClient.useSession.get());

  useEffect(() => authClient.useSession.subscribe((value) => setSession(value)), []);

  return session;
}

export default {
  signIn: authClient.signIn,
  signOut: authClient.signOut,
  updateUser: authClient.updateUser,
  useSession,
};
