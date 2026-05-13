import { defineVoidFateRoute } from 'void-fate/server';
import { fateStream } from '../src/fate/live.ts';
import { fateLive, fateServer } from '../src/fate/server.ts';

const route = defineVoidFateRoute(fateServer, fateLive, { stream: fateStream });

export const GET = route.GET;
export const POST = route.POST;
