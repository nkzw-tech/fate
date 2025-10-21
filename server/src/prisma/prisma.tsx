import { PrismaClient } from './prisma-client/client.ts';

declare global {
  namespace PrismaJson {}
}

export default new PrismaClient();
