import { eq } from 'drizzle-orm';
import db from './db.ts';
import {
  comment,
  event,
  eventAttendee,
  post,
  postToTag,
  type CategoryRow,
  type CommentRow,
  type EventAttendeeRow,
  type EventRow,
  type PostRow,
  type TagRow,
  type UserRow,
} from './schema.ts';

type ItemRecord = Record<string, unknown>;

export type CommentItem = CommentRow &
  ItemRecord & {
    author?: UserRow | null;
    post?: PostItem | null;
  };

export type PostItem = PostRow &
  ItemRecord & {
    author?: UserRow | null;
    category?: CategoryRow | null;
    comments?: Array<CommentItem>;
    tags?: Array<TagRow>;
  };

export type CategoryItem = CategoryRow &
  ItemRecord & {
    posts?: Array<PostItem>;
  };

export type EventAttendeeItem = EventAttendeeRow &
  ItemRecord & {
    user?: UserRow | null;
  };

export type EventItem = EventRow &
  ItemRecord & {
    attendees?: Array<EventAttendeeItem>;
    host?: UserRow | null;
  };

const mapTags = (links?: Array<{ tag?: TagRow | null }>) =>
  links?.flatMap((link) => (link.tag ? [link.tag] : [])) ?? [];

const toPostSummary = (record: any): PostItem => ({
  ...record,
  author: record.author ?? null,
  category: record.category ?? null,
  comments: (record.comments ?? []).map((entry: any) => ({
    ...entry,
    author: entry.author ?? null,
  })),
  tags: mapTags(record.postLinks),
});

const toPostItem = (record: any): PostItem => {
  const postItem = toPostSummary(record);
  postItem.comments = (record.comments ?? []).map((entry: any) => ({
    ...entry,
    author: entry.author ?? null,
    post: postItem,
  }));
  return postItem;
};

const toCommentItem = (record: any): CommentItem => ({
  ...record,
  author: record.author ?? null,
  post: record.post ? toPostSummary(record.post) : null,
});

const toCategoryItem = (record: any): CategoryItem => ({
  ...record,
  posts: (record.posts ?? []).map(toPostItem),
});

const toEventItem = (record: any): EventItem => ({
  ...record,
  attendees: (record.attendees ?? []).map((entry: any) => ({
    ...entry,
    user: entry.user ?? null,
  })),
  host: record.host ?? null,
});

const takeConnectionSlice = <T extends { id: string }>({
  cursor,
  direction,
  items,
  take,
}: {
  cursor?: string;
  direction: 'backward' | 'forward';
  items: Array<T>;
  take: number;
}) => {
  if (!cursor) {
    return direction === 'forward'
      ? items.slice(0, take)
      : items.slice(Math.max(0, items.length - take));
  }

  const index = items.findIndex((item) => item.id === cursor);
  if (index < 0) {
    return direction === 'forward'
      ? items.slice(0, take)
      : items.slice(Math.max(0, items.length - take));
  }

  if (direction === 'forward') {
    return items.slice(index + 1, index + 1 + take);
  }

  return items.slice(Math.max(0, index - take), index);
};

const listPostRecords = async () =>
  db.query.post.findMany({
    orderBy: (post, { desc }) => [desc(post.createdAt)],
    with: {
      author: true,
      category: true,
      comments: {
        orderBy: (comment, { asc }) => [asc(comment.createdAt)],
        with: {
          author: true,
        },
      },
      postLinks: {
        with: {
          tag: true,
        },
      },
    },
  });

const listCategoryRecords = async () =>
  db.query.category.findMany({
    orderBy: (category, { asc }) => [asc(category.createdAt)],
    with: {
      posts: {
        orderBy: (post, { desc }) => [desc(post.createdAt)],
        with: {
          author: true,
          category: true,
          comments: {
            orderBy: (comment, { asc }) => [asc(comment.createdAt)],
            with: {
              author: true,
            },
          },
          postLinks: {
            with: {
              tag: true,
            },
          },
        },
      },
    },
  });

const listCommentRecords = async () =>
  db.query.comment.findMany({
    orderBy: (comment, { desc }) => [desc(comment.createdAt)],
    with: {
      author: true,
      post: {
        with: {
          author: true,
          category: true,
          comments: {
            orderBy: (comment, { asc }) => [asc(comment.createdAt)],
            with: {
              author: true,
            },
          },
          postLinks: {
            with: {
              tag: true,
            },
          },
        },
      },
    },
  });

const listEventRecords = async () =>
  db.query.event.findMany({
    orderBy: (event, { asc }) => [asc(event.startAt)],
    with: {
      attendees: {
        orderBy: (attendee, { asc }) => [asc(attendee.createdAt)],
        with: {
          user: true,
        },
      },
      host: true,
    },
  });

export const getUserById = async (id: string) => {
  const users = await db.query.user.findMany();
  return users.find((user) => user.id === id) ?? null;
};

export const listTags = async () => db.query.tag.findMany();

export const getTagsByIds = async (ids: Array<string>) => {
  const tags = await listTags();
  return tags.filter((tag) => ids.includes(tag.id));
};

export const listPosts = async () => (await listPostRecords()).map(toPostItem);

export const getPostById = async (id: string) => {
  const posts = await listPosts();
  return posts.find((post) => post.id === id) ?? null;
};

export const getPostsByIds = async (ids: Array<string>) => {
  const posts = await listPosts();
  return posts.filter((post) => ids.includes(post.id));
};

export const listPostsConnection = async (options: {
  cursor?: string;
  direction: 'backward' | 'forward';
  take: number;
}) => takeConnectionSlice({ ...options, items: await listPosts() });

export const createPostRecord = async ({
  authorId,
  categoryId,
  content,
  likes = 0,
  tagIds = [],
  title,
}: {
  authorId: string;
  categoryId?: string | null;
  content: string;
  likes?: number;
  tagIds?: Array<string>;
  title: string;
}) => {
  const [created] = await db
    .insert(post)
    .values({
      authorId,
      categoryId,
      content,
      likes,
      title,
      updatedAt: new Date(),
    })
    .returning({ id: post.id });

  if (!created) {
    return null;
  }

  if (tagIds.length) {
    await attachTagsToPost(created.id, tagIds);
  }

  return getPostById(created.id);
};

export const likePostRecord = async (id: string) => {
  const existing = await getPostById(id);
  if (!existing) {
    return null;
  }

  await db
    .update(post)
    .set({
      likes: existing.likes + 1,
      updatedAt: new Date(),
    })
    .where(eq(post.id, id));

  return getPostById(id);
};

export const unlikePostRecord = async (id: string) => {
  const existing = await getPostById(id);
  if (!existing) {
    return null;
  }

  if (existing.likes > 0) {
    await db
      .update(post)
      .set({
        likes: existing.likes - 1,
        updatedAt: new Date(),
      })
      .where(eq(post.id, id));
  }

  return getPostById(id);
};

export const listCategories = async () => (await listCategoryRecords()).map(toCategoryItem);

export const getCategoriesByIds = async (ids: Array<string>) => {
  const categories = await listCategories();
  return categories.filter((category) => ids.includes(category.id));
};

export const listCategoriesConnection = async (options: {
  cursor?: string;
  direction: 'backward' | 'forward';
  take: number;
}) => takeConnectionSlice({ ...options, items: await listCategories() });

export const listComments = async () => (await listCommentRecords()).map(toCommentItem);

export const getCommentById = async (id: string) => {
  const comments = await listComments();
  return comments.find((comment) => comment.id === id) ?? null;
};

export const getCommentsByIds = async (ids: Array<string>) => {
  const comments = await listComments();
  return comments.filter((comment) => ids.includes(comment.id));
};

export const searchCommentsConnection = async ({
  cursor,
  direction,
  query,
  take,
}: {
  cursor?: string;
  direction: 'backward' | 'forward';
  query: string;
  take: number;
}) => {
  const comments = (await listComments()).filter((comment) =>
    comment.content.toLowerCase().includes(query.toLowerCase()),
  );
  return takeConnectionSlice({ cursor, direction, items: comments, take });
};

export const createCommentRecord = async ({
  authorId,
  content,
  postId,
}: {
  authorId: string;
  content: string;
  postId: string;
}) => {
  const [created] = await db
    .insert(comment)
    .values({
      authorId,
      content,
      postId,
    })
    .returning({ id: comment.id });

  return created ? getCommentById(created.id) : null;
};

export const deleteCommentRecord = async (id: string) => {
  const existing = await getCommentById(id);
  if (!existing) {
    return null;
  }

  await db.delete(comment).where(eq(comment.id, id));

  if (existing.post?.comments) {
    existing.post.comments = existing.post.comments.filter((comment) => comment.id !== id);
  }

  return existing;
};

export const listEvents = async () => (await listEventRecords()).map(toEventItem);

export const getEventsByIds = async (ids: Array<string>) => {
  const events = await listEvents();
  return events.filter((event) => ids.includes(event.id));
};

export const listEventsConnection = async (options: {
  cursor?: string;
  direction: 'backward' | 'forward';
  take: number;
}) => takeConnectionSlice({ ...options, items: await listEvents() });

export const attachTagsToPost = async (postId: string, tagIds: Array<string>) => {
  if (!tagIds.length) {
    return;
  }

  await db.insert(postToTag).values(tagIds.map((tagId) => ({ postId, tagId })));
};

export const createEventRecord = async ({
  attendees,
  capacity,
  description,
  endAt,
  hostId,
  livestreamUrl,
  location,
  name,
  startAt,
  topics,
  type,
}: {
  attendees: Array<{ notes: string | null; status: EventAttendeeRow['status']; userId: string }>;
  capacity: number;
  description: string;
  endAt: Date;
  hostId: string;
  livestreamUrl: string | null;
  location: string;
  name: string;
  startAt: Date;
  topics: Array<string>;
  type: EventRow['type'];
}) => {
  const [created] = await db
    .insert(event)
    .values({
      capacity,
      description,
      endAt,
      hostId,
      livestreamUrl,
      location,
      name,
      startAt,
      topics,
      type,
      updatedAt: new Date(),
    })
    .returning({ id: event.id });

  if (!created) {
    return null;
  }

  if (attendees.length) {
    await db.insert(eventAttendee).values(
      attendees.map((attendee) => ({
        ...attendee,
        eventId: created.id,
      })),
    );
  }

  return getEventsByIds([created.id]).then((events) => events[0] ?? null);
};
