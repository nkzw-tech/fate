import {
  asc,
  computed,
  count,
  dataView,
  defineSource,
  desc,
  field,
  list,
  many,
  manyToMany,
  one,
  type Entity,
} from '@nkzw/fate/server';
import type {
  CategoryItem,
  CommentItem,
  EventAttendeeItem,
  EventItem,
  PostItem,
} from '../drizzle/queries.ts';
import type { CategoryRow, TagRow, UserRow } from '../drizzle/schema.ts';
import type { AppContext } from './context.ts';

export const userDataView = dataView<UserRow>('User')({
  email: computed<UserRow, string | null, AppContext>({
    authorize: ({ id }, context) => context?.sessionUser?.id === id,
    needs: {
      email: field('email'),
    },
    resolve: (_item, deps) => (deps.email as string | null) ?? null,
  }),
  id: true,
  name: true,
  username: true,
});

export const tagDataView = dataView<TagRow>('Tag')({
  description: true,
  id: true,
  name: true,
});

const categorySummaryDataView = dataView<CategoryRow>('Category')({
  id: true,
  name: true,
});

const basePost = {
  author: userDataView,
  category: categorySummaryDataView,
  commentCount: computed<PostItem, number>({
    needs: {
      count: count('comments'),
    },
    resolve: (_item, deps) => (deps.count as number) ?? 0,
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
  postCount: computed<CategoryItem, number>({
    needs: {
      count: count('posts'),
    },
    resolve: (_item, deps) => (deps.count as number) ?? 0,
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
  attendingCount: computed<EventItem, number>({
    needs: {
      count: count('attendees', {
        where: { status: 'GOING' },
      }),
    },
    resolve: (_item, deps) => (deps.count as number) ?? 0,
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

export const userSource = defineSource(userDataView, {
  id: 'id',
});

export const tagSource = defineSource(tagDataView, {
  id: 'id',
  orderBy: [asc('name'), asc('id')],
});

export const categorySummarySource = defineSource(categorySummaryDataView, {
  id: 'id',
  orderBy: [asc('createdAt'), asc('id')],
});

export const postSummarySource = defineSource(postSummaryDataView, {
  id: 'id',
  orderBy: [desc('createdAt'), desc('id')],
  relations: {
    author: one(() => userSource, {
      foreignKey: 'id',
      localKey: 'authorId',
    }),
    category: one(() => categorySummarySource, {
      foreignKey: 'id',
      localKey: 'categoryId',
    }),
    tags: manyToMany(() => tagSource, {
      foreignKey: 'id',
      localKey: 'id',
      orderBy: [asc('name'), asc('id')],
      through: {
        foreignKey: 'tagId',
        localKey: 'postId',
      },
    }),
  },
});

export const commentSource = defineSource(commentDataView, {
  id: 'id',
  orderBy: [desc('createdAt'), desc('id')],
  relations: {
    author: one(() => userSource, {
      foreignKey: 'id',
      localKey: 'authorId',
    }),
    post: one(() => postSummarySource, {
      foreignKey: 'id',
      localKey: 'postId',
    }),
  },
});

export const postSource = defineSource(postDataView, {
  id: 'id',
  orderBy: [desc('createdAt'), desc('id')],
  relations: {
    author: one(() => userSource, {
      foreignKey: 'id',
      localKey: 'authorId',
    }),
    category: one(() => categorySummarySource, {
      foreignKey: 'id',
      localKey: 'categoryId',
    }),
    comments: many(() => commentSource, {
      foreignKey: 'postId',
      localKey: 'id',
      orderBy: [desc('createdAt'), desc('id')],
    }),
    tags: manyToMany(() => tagSource, {
      foreignKey: 'id',
      localKey: 'id',
      orderBy: [asc('name'), asc('id')],
      through: {
        foreignKey: 'tagId',
        localKey: 'postId',
      },
    }),
  },
});

export const categorySource = defineSource(categoryDataView, {
  id: 'id',
  orderBy: [asc('createdAt'), asc('id')],
  relations: {
    posts: many(() => postSource, {
      foreignKey: 'categoryId',
      localKey: 'id',
      orderBy: [desc('createdAt'), desc('id')],
    }),
  },
});

export const eventAttendeeSource = defineSource(eventAttendeeDataView, {
  id: 'id',
  orderBy: [asc('createdAt'), asc('id')],
  relations: {
    user: one(() => userSource, {
      foreignKey: 'id',
      localKey: 'userId',
    }),
  },
});

export const eventSource = defineSource(eventDataView, {
  id: 'id',
  orderBy: [asc('startAt'), asc('id')],
  relations: {
    attendees: many(() => eventAttendeeSource, {
      foreignKey: 'eventId',
      localKey: 'id',
      orderBy: [asc('createdAt'), asc('id')],
    }),
    host: one(() => userSource, {
      foreignKey: 'id',
      localKey: 'hostId',
    }),
  },
});

export const Root = {
  categories: list(categoryDataView),
  commentSearch: { procedure: 'search', view: list(commentDataView) },
  events: list(eventDataView),
  posts: list(postDataView),
  viewer: userDataView,
};
