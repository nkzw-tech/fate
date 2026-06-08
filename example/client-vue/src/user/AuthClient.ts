import { createAuthClient } from 'better-auth/vue';
import env from '../lib/env.ts';

export default createAuthClient({
  baseURL: env('SERVER_URL'),
});
