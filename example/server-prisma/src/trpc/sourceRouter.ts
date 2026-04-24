import { bindSourceProcedures } from '@nkzw/fate/server';
import { createConnectionProcedure } from './connection.ts';
import type { AppContext } from './context.ts';
import { prismaRegistry } from './executor.ts';
import { procedure } from './init.ts';

export const sourceProcedures = bindSourceProcedures<
  AppContext,
  typeof procedure,
  typeof createConnectionProcedure
>({
  createConnectionProcedure,
  procedure,
  registry: prismaRegistry,
});

export { createConnectionProcedure };
