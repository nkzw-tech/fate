import { dataView, type Entity, list, resolver } from '@nkzw/fate/server';
import type {
  Category as PrismaCategory,
  Comment as PrismaComment,
  Event as PrismaEvent,
  EventAttendee as PrismaEventAttendee,
  Post as PrismaPost,
  Tag as PrismaTag,
  User as PrismaUser,
} from '../prisma/prisma-client/client.ts';
import { AppContext } from './context.ts';

export type CommentItem = PrismaComment & {
  author?: PrismaUser | null;
  post?: PrismaPost | null;
};

export type PostItem = PrismaPost & {
  _count?: { comments: number };
  author?: PrismaUser | null;
  category?: PrismaCategory | null;
  comments?: Array<CommentItem>;
  tags?: Array<PrismaTag>;
};

export type CategoryItem = PrismaCategory & {
  _count?: { posts: number };
  posts?: Array<PostItem>;
};

type EventAttendeeItem = PrismaEventAttendee & {
  user?: PrismaUser | null;
};

export type EventItem = PrismaEvent & {
  _count?: { attendees: number };
  attendees?: Array<EventAttendeeItem>;
  host?: PrismaUser | null;
};

export const userDataView = dataView<PrismaUser>('User')({
  email: resolver<PrismaUser, string | null, AppContext>({
    authorize: ({ id }, context) => context?.sessionUser?.id === id,
    resolve: ({ email }) => email,
  }),
  id: true,
  name: true,
  username: true,
});

export const tagDataView = dataView<PrismaTag>('Tag')({
  description: true,
  id: true,
  name: true,
});

const categorySummaryDataView = dataView<PrismaCategory>('Category')({
  id: true,
  name: true,
});

const basePost = {
  author: userDataView,
  category: categorySummaryDataView,
  commentCount: resolver<PostItem, number>({
    resolve: ({ _count }) => _count?.comments ?? 0,
    select: () => ({
      _count: { select: { comments: true } },
    }),
  }),
  content: true,
  id: true,
  likes: true,
  title: true,
} as const;

const postSummaryDataView = dataView<PostItem>('Post')({
  ...basePost,
  tags: list(tagDataView),
});

export const commentDataView = dataView<CommentItem>('Comment')({
  author: userDataView,
  content: true,
  id: true,
  post: postSummaryDataView,
});

export const postDataView = dataView<PostItem>('Post')({
  ...basePost,
  comments: list(commentDataView),
  tags: list(tagDataView),
});

export const categoryDataView = dataView<CategoryItem>('Category')({
  description: true,
  id: true,
  name: true,
  postCount: resolver<CategoryItem, number>({
    resolve: ({ _count }) => _count?.posts ?? 0,
    select: () => ({
      _count: { select: { posts: true } },
    }),
  }),
  posts: list(postDataView),
});

export const eventAttendeeDataView = dataView<EventAttendeeItem>('EventAttendee')({
  id: true,
  notes: true,
  status: true,
  user: userDataView,
});

export const eventDataView = dataView<EventItem>('Event')({
  attendees: list(eventAttendeeDataView),
  attendingCount: resolver<EventItem, number>({
    resolve: ({ _count }) => _count?.attendees ?? 0,
    select: () => ({
      _count: {
        select: {
          attendees: {
            where: { status: 'GOING' },
          },
        },
      },
    }),
  }),
  capacity: true,
  description: true,
  endAt: true,
  host: userDataView,
  id: true,
  livestreamUrl: true,
  location: true,
  name: true,
  startAt: true,
  topics: true,
  type: true,
});

export type User = Entity<typeof userDataView, 'User'>;
export type Tag = Entity<typeof tagDataView, 'Tag'>;
export type Comment = Entity<
  typeof commentDataView,
  'Comment',
  {
    author: User;
    post: Post;
  }
>;
export type EventAttendee = Entity<
  typeof eventAttendeeDataView,
  'EventAttendee',
  {
    user: User;
  }
>;
export type Post = Entity<
  typeof postDataView,
  'Post',
  {
    author: User;
    category: Category | null;
    comments: Array<Comment>;
    tags: Array<Tag>;
  }
>;
export type Category = Entity<
  typeof categoryDataView,
  'Category',
  {
    posts: Array<Post>;
  }
>;
export type Event = Entity<
  typeof eventDataView,
  'Event',
  {
    attendees: Array<EventAttendee>;
    host: User;
  }
>;

export const Root = {
  categories: list(categoryDataView),
  commentSearch: { procedure: 'search', view: list(commentDataView) },
  events: list(eventDataView),
  posts: list(postDataView),
  viewer: userDataView,
};
