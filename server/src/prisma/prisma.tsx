import { PrismaPg } from '@prisma/adapter-pg';
import env from '../lib/env.tsx';
import { PrismaClient } from './prisma-client/client.ts';

const adapter = new PrismaPg({
  connectionString: env('DATABASE_URL'),
});

export default new PrismaClient({ adapter });
