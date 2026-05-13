import { eq, ilike, sql } from 'drizzle-orm';
import db, { type Database, type Transaction } from './db.ts';
import { comment, post } from './schema.ts';

type RuntimeDb = Database | Transaction;

const resolveDb = (runtimeDb?: RuntimeDb) => runtimeDb ?? db;

export const createPostRecord = async ({
  authorId,
  content,
  title,
}: {
  authorId: string;
  content: string;
  title: string;
}) => {
  const [created] = await db.insert(post).values({ authorId, content, title }).returning({
    id: post.id,
  });
  return created?.id ?? null;
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
  return updated?.id ?? null;
};

export const unlikePostRecord = async (id: string) => {
  const [updated] = await db
    .update(post)
    .set({
      likes: sql`GREATEST(${post.likes} - 1, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(post.id, id))
    .returning({ id: post.id });
  return updated?.id ?? null;
};

export const createCommentRecord = async ({
  authorId,
  content,
  postId,
  runtimeDb,
}: {
  authorId?: null | string;
  content: string;
  postId: string;
  runtimeDb?: RuntimeDb;
}) => {
  const [created] = await resolveDb(runtimeDb)
    .insert(comment)
    .values({ authorId, content, postId })
    .returning({ id: comment.id });
  return created?.id ?? null;
};

export const deleteCommentRecord = async (id: string, runtimeDb?: RuntimeDb) => {
  const [deleted] = await resolveDb(runtimeDb)
    .delete(comment)
    .where(eq(comment.id, id))
    .returning({ id: comment.id, postId: comment.postId });
  return deleted ?? null;
};

export const findCommentPostId = async (id: string, runtimeDb?: RuntimeDb) => {
  const [result] = await resolveDb(runtimeDb)
    .select({ postId: comment.postId })
    .from(comment)
    .where(eq(comment.id, id))
    .limit(1);
  return result?.postId ?? null;
};

export const postExists = async (id: string) => {
  const [result] = await db.select({ id: post.id }).from(post).where(eq(post.id, id)).limit(1);
  return Boolean(result);
};

export const commentSearchWhere = (query: string) =>
  query.trim().length ? ilike(comment.content, `%${query.trim()}%`) : undefined;
