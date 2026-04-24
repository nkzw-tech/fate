import { createDrizzleSourceRuntime } from '@nkzw/fate/server/drizzle';
import db from '../drizzle/db.ts';
import {
  category,
  comment,
  event,
  eventAttendee,
  post,
  postToTag,
  tag,
  user,
} from '../drizzle/schema.ts';
import type { AppContext } from './context.ts';
import {
  categorySource,
  categorySummarySource,
  commentSource,
  eventAttendeeSource,
  eventSource,
  postSource,
  postSummarySource,
  tagSource,
  userSource,
} from './views.ts';

export const drizzleRuntime = createDrizzleSourceRuntime<AppContext>({
  db,
  sources: [
    {
      source: categorySource,
      table: category,
    },
    {
      source: categorySummarySource,
      table: category,
    },
    {
      source: commentSource,
      table: comment,
    },
    {
      source: eventAttendeeSource,
      table: eventAttendee,
    },
    {
      source: eventSource,
      table: event,
    },
    {
      manyToMany: {
        tags: postToTag,
      },
      source: postSource,
      table: post,
    },
    {
      manyToMany: {
        tags: postToTag,
      },
      source: postSummarySource,
      table: post,
    },
    {
      source: tagSource,
      table: tag,
    },
    {
      source: userSource,
      table: user,
    },
  ],
});

export const drizzleRegistry = drizzleRuntime.registry;
