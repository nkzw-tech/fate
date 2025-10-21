import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { admin, username } from 'better-auth/plugins';
import prisma from '../prisma/prisma.tsx';
import env from './env.tsx';

export const auth = betterAuth({
  advanced: {
    database: {
      generateId: false,
    },
  },
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
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
