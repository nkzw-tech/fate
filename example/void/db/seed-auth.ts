import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import authConfig from '../auth.ts';
import schema from './schema.ts';

const seedAuthURL = 'http://localhost:6001';

export const createSeedAuth = (database: Parameters<typeof drizzleAdapter>[0]) => {
  const defaults: BetterAuthOptions = {
    basePath: '/api/auth',
    baseURL: seedAuthURL,
    database: drizzleAdapter(database, {
      provider: 'sqlite',
      schema,
    }),
    emailAndPassword: {
      enabled: true,
    },
    secret: process.env.BETTER_AUTH_SECRET ?? 'fate-void-example-development-secret',
    trustedOrigins: [seedAuthURL],
  };

  return betterAuth(
    authConfig({
      defaults,
      dialect: 'sqlite',
      env: process.env,
      request: new Request(`${seedAuthURL}/api/auth`),
    }),
  );
};
