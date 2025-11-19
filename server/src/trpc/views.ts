import { dataView, DataViewResult, list, resolver } from '@nkzw/fate/server';
import type {
  Category as PrismaCategory,
  Comment as PrismaComment,
  Event as PrismaEvent,
  EventAttendee as PrismaEventAttendee,
  Post as PrismaPost,
  Project as PrismaProject,
  ProjectUpdate as PrismaProjectUpdate,
  Tag as PrismaTag,
  User as PrismaUser,
} from '../prisma/prisma-client/client.ts';

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

type ProjectUpdateItem = PrismaProjectUpdate & {
  author?: PrismaUser | null;
};

export type ProjectItem = PrismaProject & {
  owner?: PrismaUser | null;
  updates?: Array<ProjectUpdateItem>;
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
  commentCount: resolver<PostItem>({
    resolve: ({ item }) => item._count?.comments ?? 0,
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
  postCount: resolver<CategoryItem>({
    resolve: ({ item }) => item._count?.posts ?? 0,
    select: () => ({
      _count: { select: { posts: true } },
    }),
  }),
  posts: list(postDataView),
});

export const projectUpdateDataView = dataView<ProjectUpdateItem>(
  'ProjectUpdate',
)({
  author: userDataView,
  confidence: true,
  content: true,
  createdAt: true,
  id: true,
  mood: true,
});

export const projectDataView = dataView<ProjectItem>('Project')({
  focusAreas: true,
  id: true,
  metrics: true,
  name: true,
  owner: userDataView,
  progress: true,
  startDate: true,
  status: true,
  summary: true,
  targetDate: true,
  updates: list(projectUpdateDataView),
});

export const eventAttendeeDataView = dataView<EventAttendeeItem>(
  'EventAttendee',
)({
  id: true,
  notes: true,
  status: true,
  user: userDataView,
});

export const eventDataView = dataView<EventItem>('Event')({
  attendees: list(eventAttendeeDataView),
  attendingCount: resolver<EventItem>({
    resolve: ({ item }) => item._count?.attendees ?? 0,
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
  resources: true,
  startAt: true,
  topics: true,
  type: true,
});

export type User = DataViewResult<typeof userDataView> & {
  __typename: 'User';
};
export type Tag = DataViewResult<typeof tagDataView> & { __typename: 'Tag' };
export type Comment = Omit<DataViewResult<typeof commentDataView>, 'author'> & {
  __typename: 'Comment';
  author: User;
  post: Post;
};
export type ProjectUpdate = Omit<
  DataViewResult<typeof projectUpdateDataView>,
  'author'
> & {
  __typename: 'ProjectUpdate';
  author: User;
};
export type EventAttendee = Omit<
  DataViewResult<typeof eventAttendeeDataView>,
  'user'
> & {
  __typename: 'EventAttendee';
  user: User;
};
export type Post = Omit<
  DataViewResult<typeof postDataView>,
  'author' | 'category' | 'comments' | 'tags'
> & {
  __typename: 'Post';
  author: User;
  category: Category | null;
  commentCount: number;
  comments: Array<Comment>;
  tags: Array<Tag>;
};
export type Category = Omit<
  DataViewResult<typeof categoryDataView>,
  'posts'
> & {
  __typename: 'Category';
  postCount: number;
  posts: Array<Post>;
};
export type Project = Omit<
  DataViewResult<typeof projectDataView>,
  'owner' | 'updates'
> & {
  __typename: 'Project';
  owner: User;
  updates: Array<ProjectUpdate>;
};
export type Event = Omit<
  DataViewResult<typeof eventDataView>,
  'attendees' | 'host'
> & {
  __typename: 'Event';
  attendees: Array<EventAttendee>;
  attendingCount: number;
  host: User;
};

export const Lists = {
  categories: categoryDataView,
  events: eventDataView,
  posts: postDataView,
  projects: projectDataView,
};
