import { and, eq, gt, sql } from 'drizzle-orm';
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
    await db.insert(postToTag).values(tagIds.map((tagId) => ({ postId: created.id, tagId })));
  }

  return created.id;
};

export const likePostRecord = async (id: string) => {
  const [updated] = await db
    .update(post)
    .set({
      likes: sql`${post.likes} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(post.id, id))
    .returning({ id: post.id });

  return Boolean(updated);
};

export const unlikePostRecord = async (id: string) => {
  const [updated] = await db
    .update(post)
    .set({
      likes: sql`${post.likes} - 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(post.id, id), gt(post.likes, 0)))
    .returning({ id: post.id });

  if (updated) {
    return true;
  }

  const [existing] = await db.select({ id: post.id }).from(post).where(eq(post.id, id)).limit(1);

  return Boolean(existing);
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

  return created?.id ?? null;
};

export const deleteCommentRecord = async (id: string) => {
  await db.delete(comment).where(eq(comment.id, id));
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

  return created.id;
};
