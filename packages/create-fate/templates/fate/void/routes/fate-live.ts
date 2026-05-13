import { defineVoidFateLiveRoute } from 'void-fate/server';
import 'void/live';
import { fateStream } from '../src/fate/live.ts';

const route = defineVoidFateLiveRoute(fateStream);

export const GET = route.GET;
export const POST = route.POST;
