import { httpBatchLink } from '@trpc/client';
import env from './env.tsx';
import { createFateClient } from './fate.generated.ts';

export const fate = createFateClient({
  links: [
    httpBatchLink({
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          credentials: 'include',
        }),
      url: `${env('SERVER_URL')}/trpc`,
    }),
  ],
});
