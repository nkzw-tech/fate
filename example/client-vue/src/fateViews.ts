import type {
  Category,
  Comment,
  Event,
  EventAttendee,
  Post,
  Tag,
  User,
} from '@nkzw/fate-server/src/trpc/views.ts';
import { defer, view } from 'vue-fate';

export const UserView = view<User>()({
  id: true,
  name: true,
  username: true,
});

export const UserCardView = view<User>()({
  email: true,
  id: true,
  name: true,
  username: true,
});

export const TagView = view<Tag>()({
  id: true,
  name: true,
});

export const CommentView = view<Comment>()({
  author: {
    id: true,
    name: true,
    username: true,
  },
  content: true,
  id: true,
});

export const CommentViewWithPostCount = view<Comment>()({
  ...CommentView,
  post: { commentCount: true },
});

export const CategorySummaryView = view<Category>()({
  id: true,
  name: true,
});

export const CommentConnectionView = {
  args: { first: 3 },
  items: {
    node: CommentView,
  },
  live: {
    append: 'visible',
  },
};

export const PostView = view<Post>()({
  author: UserView,
  category: CategorySummaryView,
  commentCount: true,
  comments: defer(CommentConnectionView),
  content: true,
  id: true,
  likes: true,
  tags: {
    items: {
      node: TagView,
    },
  },
  title: true,
});

export const CategoryPostView = view<Post>()({
  author: UserView,
  id: true,
  likes: true,
  tags: {
    items: {
      node: TagView,
    },
  },
  title: true,
});

export const CategoryView = view<Category>()({
  description: true,
  id: true,
  name: true,
  postCount: true,
  posts: {
    items: {
      node: CategoryPostView,
    },
    pagination: {
      hasNext: true,
      nextCursor: true,
    },
  },
});

export const EventAttendeeView = view<EventAttendee>()({
  id: true,
  notes: true,
  status: true,
  user: UserView,
});

export const EventView = view<Event>()({
  attendees: {
    items: {
      node: EventAttendeeView,
    },
  },
  attendingCount: true,
  capacity: true,
  description: true,
  endAt: true,
  host: UserView,
  id: true,
  livestreamUrl: true,
  location: true,
  name: true,
  startAt: true,
  topics: true,
  type: true,
});

export const CommentPostView = view<Post>()({
  commentCount: true,
  id: true,
  title: true,
});

export const CommentSearchView = view<Comment>()({
  ...CommentView,
  id: true,
  post: CommentPostView,
});
