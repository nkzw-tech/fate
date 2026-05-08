import { defineHandler } from 'void';
import { auth } from '../../../src/lib/auth.ts';

export const GET = defineHandler((context) => auth.handler(context.req.raw));

export const POST = defineHandler((context) => auth.handler(context.req.raw));
