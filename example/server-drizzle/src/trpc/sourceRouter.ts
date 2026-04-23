import { createSourceProcedureFactory } from '@nkzw/fate/server';
import { createConnectionProcedure } from './connection.ts';
import type { AppContext } from './context.ts';
import { drizzleRegistry } from './executor.ts';
import { procedure } from './init.ts';

export const sourceProcedures = createSourceProcedureFactory<
  AppContext,
  typeof procedure,
  typeof createConnectionProcedure
>({
  createConnectionProcedure,
  procedure,
  registry: drizzleRegistry,
});

export { createConnectionProcedure };
