import { createLiveEventBus } from '@nkzw/fate/server';
import { createPrismaSourceAdapter } from '@nkzw/fate/server/prisma';
import type { AppContext } from './context.tsx';
import {
  categoryDataView,
  commentDataView,
  eventAttendeeDataView,
  eventDataView,
  postDataView,
  Root,
  tagDataView,
  userDataView,
} from './views.ts';

export const live = createLiveEventBus();

export const fate = createPrismaSourceAdapter<AppContext>({
  views: Root,
});

export const viewsByType = {
  Category: categoryDataView,
  Comment: commentDataView,
  Event: eventDataView,
  EventAttendee: eventAttendeeDataView,
  Post: postDataView,
  Tag: tagDataView,
  User: userDataView,
} as const;
