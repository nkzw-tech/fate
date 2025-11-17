import { dataView, DataViewResult, resolver } from '../fate-server/dataView.ts';
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

export const userDataView = dataView<PrismaUser>()({
  id: true,
  name: true,
  username: true,
});

export const tagDataView = dataView<PrismaTag>()({
  description: true,
  id: true,
  name: true,
});

const commentPostDataView = dataView<PrismaPost>()({
  id: true,
  title: true,
});

export const commentDataView = dataView<CommentItem>()({
  author: userDataView,
  content: true,
  id: true,
  post: commentPostDataView,
});

const categorySummaryDataView = dataView<PrismaCategory>()({
  id: true,
  name: true,
});

export const postDataView = dataView<PostItem>()({
  author: userDataView,
  category: categorySummaryDataView,
  comments: commentDataView,
  content: true,
  id: true,
  likes: true,
  tags: tagDataView,
  title: true,
});

export const categoryDataView = dataView<CategoryItem>()({
  description: true,
  id: true,
  name: true,
  postCount: resolver<CategoryItem>({
    resolve: ({ item }) => item._count?.posts ?? 0,
    select: () => ({
      _count: { select: { posts: true } },
    }),
  }),
  posts: postDataView,
});

export const projectUpdateDataView = dataView<ProjectUpdateItem>()({
  author: userDataView,
  confidence: true,
  content: true,
  createdAt: true,
  id: true,
  mood: true,
});

export const projectDataView = dataView<ProjectItem>()({
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
  updates: projectUpdateDataView,
});

export const eventAttendeeDataView = dataView<EventAttendeeItem>()({
  id: true,
  notes: true,
  status: true,
  user: userDataView,
});

export const eventDataView = dataView<EventItem>()({
  attendees: eventAttendeeDataView,
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
