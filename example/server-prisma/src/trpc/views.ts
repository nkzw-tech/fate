import { computed, count, dataView, field, list, type Entity } from '@nkzw/fate/server';
import getMixedSearchPage from '../../../mixedSearch.ts';
import type {
  Category as PrismaCategory,
  Comment as PrismaComment,
  Event as PrismaEvent,
  EventAttendee as PrismaEventAttendee,
  Post as PrismaPost,
  Tag as PrismaTag,
  User as PrismaUser,
} from '../prisma/prisma-client/client.ts';
import type { AppContext } from './context.ts';

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
  email: computed<PrismaUser, string | null, AppContext>({
    authorize: ({ id }, context) => context?.sessionUser?.id === id,
    resolve: (_item, deps) => (deps.email as string | null) ?? null,
    select: {
      email: field('email'),
    },
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

export const categorySummaryDataView = dataView<PrismaCategory>('Category')({
  id: true,
  name: true,
});

const basePost = {
  author: userDataView,
  category: categorySummaryDataView,
  commentCount: computed<PostItem, number>({
    resolve: (_item, deps) => (deps.count as number) ?? 0,
    select: {
      count: count('comments'),
    },
  }),
  content: true,
  id: true,
  likes: true,
  title: true,
} as const;

export const postSummaryDataView = dataView<PostItem>('Post')({
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
  comments: list(commentDataView, { orderBy: { createdAt: 'asc', id: 'asc' } }),
  tags: list(tagDataView),
});

export const categoryDataView = dataView<CategoryItem>('Category')({
  description: true,
  id: true,
  name: true,
  postCount: computed<CategoryItem, number>({
    resolve: (_item, deps) => (deps.count as number) ?? 0,
    select: {
      count: count('posts'),
    },
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
  attendees: list(eventAttendeeDataView, { orderBy: { createdAt: 'asc', id: 'asc' } }),
  attendingCount: computed<EventItem, number>({
    resolve: (_item, deps) => (deps.count as number) ?? 0,
    select: {
      count: count('attendees', {
        where: { status: 'GOING' },
      }),
    },
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

const searchMembers = { Post: postDataView, User: userDataView };
const search = list<typeof searchMembers, AppContext>(searchMembers, {
  async query({ args, ctx, cursor, direction, take }) {
    const query = typeof args?.query === 'string' ? args.query.trim() : '';
    if (!query) {
      return [];
    }

    const contains = { contains: query, mode: 'insensitive' } as const;
    const [posts, users] = await Promise.all([
      ctx.prisma.post.findMany({
        orderBy: { id: 'asc' },
        select: { id: true },
        where: { OR: [{ title: contains }, { content: contains }] },
      }),
      ctx.prisma.user.findMany({
        orderBy: { id: 'asc' },
        select: { id: true },
        where: { name: contains },
      }),
    ]);
    return getMixedSearchPage(posts, users, cursor, direction, take);
  },
  typeName: 'SearchResult',
});

export const Root = {
  categories: list(categoryDataView, { orderBy: { createdAt: 'asc', id: 'asc' } }),
  commentSearch: {
    procedure: 'search',
    view: list(commentDataView, { orderBy: { createdAt: 'desc', id: 'desc' } }),
  },
  events: list(eventDataView, { orderBy: [{ startAt: 'asc' }, { id: 'asc' }] }),
  posts: list(postDataView, { orderBy: { createdAt: 'desc', id: 'desc' } }),
  search: { router: 'search', view: search },
  viewer: userDataView,
};
