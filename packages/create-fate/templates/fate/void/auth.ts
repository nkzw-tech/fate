import { admin, username } from 'better-auth/plugins';
import { defineAuth } from 'void/auth';

export default defineAuth(({ defaults }) => ({
  ...defaults,
  emailAndPassword: {
    ...defaults.emailAndPassword,
    autoSignIn: true,
    enabled: true,
    maxPasswordLength: 128,
    minPasswordLength: 8,
  },
  plugins: [admin(), username()],
  session: {
    ...defaults.session,
    cookieCache: {
      enabled: true,
      maxAge: 15 * 24 * 60 * 60,
    },
  },
  telemetry: { enabled: false },
}));
