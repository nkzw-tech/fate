import { withConnection } from '@nkzw/fate/server';
import { procedure } from './init.ts';

export const createConnectionProcedure = withConnection(procedure);
