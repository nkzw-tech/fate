import { createFateFetchHandler } from '@nkzw/fate/server';
import { defineHandler } from 'void';
import { fateServer } from '../../src/fate/server.ts';

const handleFate = createFateFetchHandler(fateServer);

export const GET = defineHandler((context) => handleFate(context.req.raw, context));

export const POST = defineHandler((context) => handleFate(context.req.raw, context));
