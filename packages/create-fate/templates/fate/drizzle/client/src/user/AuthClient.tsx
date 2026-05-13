import { createAuthClient } from 'better-auth/react';
import env from '../lib/env.tsx';

export default createAuthClient({
  baseURL: env('SERVER_URL'),
});
