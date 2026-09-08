import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, username } from 'better-auth/plugins';
import { db } from '../../db/db.ts';
import schema from '../../db/schema.ts';
import { trustedOrigins } from './origins.ts';

const defaultSecret = 'fate-cloudflare-development-secret';
const betterAuthDefaultSecret = 'better-auth-secret-12345678901234567890';

const resolveSecret = (secret?: string) => {
  const value =
    secret ??
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      ?.BETTER_AUTH_SECRET;

  return value && value !== betterAuthDefaultSecret ? value : defaultSecret;
};

const createAuthInstance = (baseURL: string, secret: string) =>
  betterAuth({
    advanced: {
      database: {
        generateId: false,
      },
    },
    basePath: '/api/auth',
    baseURL,
    database: drizzleAdapter(db, {
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
    secret,
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 15 * 24 * 60 * 60,
      },
    },
    telemetry: { enabled: false },
    trustedOrigins,
  });

const authByBaseURL = new Map<string, ReturnType<typeof createAuthInstance>>();

export const createAuth = (baseURL = 'http://localhost:8787', secret?: string) => {
  const resolvedSecret = resolveSecret(secret);
  const cacheKey = `${baseURL}\0${resolvedSecret}`;
  const existing = authByBaseURL.get(cacheKey);
  if (existing) {
    return existing;
  }

  const auth = createAuthInstance(baseURL, resolvedSecret);
  authByBaseURL.set(cacheKey, auth);
  return auth;
};
