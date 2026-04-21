import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, username } from 'better-auth/plugins';
import db from '../drizzle/db.ts';
import schema from '../drizzle/schema.ts';
import env from './env.ts';

export const auth = betterAuth({
  advanced: {
    database: {
      generateId: false,
    },
  },
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  emailAndPassword: {
    autoSignIn: true,
    enabled: true,
    maxPasswordLength: 128,
    minPasswordLength: 8,
  },
  plugins: [admin(), username()],
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 15 * 24 * 60 * 60,
    },
  },
  telemetry: { enabled: false },
  trustedOrigins: [env('CLIENT_DOMAIN')],
});
