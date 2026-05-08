import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, username } from 'better-auth/plugins';
import { db, eq } from 'void/db';
import schema, { session, user } from '../../db/schema.ts';

export const createAuth = (database: Parameters<typeof drizzleAdapter>[0] = db) =>
  betterAuth({
    advanced: {
      database: {
        generateId: false,
      },
    },
    baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:6001',
    database: drizzleAdapter(database, {
      provider: 'sqlite',
      schema,
    }),
    emailAndPassword: {
      autoSignIn: true,
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 8,
    },
    plugins: [admin(), username()],
    secret: process.env.BETTER_AUTH_SECRET ?? 'fate-void-example-development-secret',
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 15 * 24 * 60 * 60,
      },
    },
    telemetry: { enabled: false },
  });

export const auth = createAuth();

const getCookie = (headers: Headers, name: string) => {
  const cookies = headers.get('cookie');
  if (!cookies) {
    return null;
  }

  for (const cookie of cookies.split(';')) {
    const [key, ...value] = cookie.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(value.join('='));
      } catch {
        return value.join('=');
      }
    }
  }

  return null;
};

export const getAuthSession = async (request: Request) => {
  const sessionCookie =
    getCookie(request.headers, 'better-auth.session_token') ??
    getCookie(request.headers, '__Secure-better-auth.session_token');
  const token = sessionCookie?.split('.')[0];

  if (!token) {
    return null;
  }

  const [result] = await db
    .select({
      session,
      user,
    })
    .from(session)
    .innerJoin(user, eq(session.userId, user.id))
    .where(eq(session.token, token))
    .limit(1);

  if (!result || result.session.expiresAt <= new Date()) {
    return null;
  }

  return result;
};
