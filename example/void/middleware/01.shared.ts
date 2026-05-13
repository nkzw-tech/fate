import { defineMiddleware } from 'void';
import { getSession } from 'void/auth';
import type { SharedData } from '../src/lib/shared.ts';

declare module 'void' {
  interface CloudContextVariables {
    shared: SharedData;
  }
}

export default defineMiddleware(async (context, next) => {
  const session = getSession();
  const url = new URL(context.req.raw.url);

  context.set('shared', {
    auth: {
      user: session?.user
        ? {
            email: session.user.email,
            id: session.user.id,
            name: session.user.name,
          }
        : null,
    },
    origin: url.origin,
  });

  await next();
});
