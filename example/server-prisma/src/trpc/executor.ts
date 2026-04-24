import { createPrismaSourceAdapter } from '@nkzw/fate/server/prisma';
import type { AppContext } from './context.ts';
import {
  categorySource,
  commentSource,
  eventSource,
  postSource,
  tagSource,
  userSource,
} from './views.ts';

export const prismaAdapter = createPrismaSourceAdapter<AppContext>({
  sources: [
    {
      delegate: (ctx) => ctx.prisma.category,
      source: categorySource,
    },
    {
      delegate: (ctx) => ctx.prisma.comment,
      source: commentSource,
    },
    {
      delegate: (ctx) => ctx.prisma.event,
      source: eventSource,
    },
    {
      delegate: (ctx) => ctx.prisma.post,
      source: postSource,
    },
    {
      delegate: (ctx) => ctx.prisma.tag,
      source: tagSource,
    },
    {
      delegate: (ctx) => ctx.prisma.user,
      source: userSource,
    },
  ],
});

export const prismaRegistry = prismaAdapter.registry;
