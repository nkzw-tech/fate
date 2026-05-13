import { randomUUID } from 'node:crypto';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const idColumn = () =>
  text()
    .notNull()
    .$defaultFn(() => randomUUID());

export const user = pgTable(
  'user',
  {
    banExpires: timestamp({ mode: 'date' }),
    banned: boolean(),
    banReason: text(),
    createdAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
    displayUsername: text(),
    email: text().notNull(),
    emailVerified: boolean().notNull().default(false),
    id: idColumn().primaryKey(),
    image: text(),
    name: text().notNull(),
    password: text(),
    role: text().notNull().default('user'),
    updatedAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
    username: text(),
  },
  (table) => [
    uniqueIndex('user_email_key').on(table.email),
    uniqueIndex('user_username_key').on(table.username),
    index('user_id_idx').on(table.id),
  ],
);

export const session = pgTable(
  'session',
  {
    createdAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp({ mode: 'date' }).notNull(),
    id: idColumn().primaryKey(),
    ipAddress: text(),
    token: text().notNull(),
    updatedAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [uniqueIndex('session_token_key').on(table.token)],
);

export const account = pgTable(
  'account',
  {
    accessToken: text(),
    accessTokenExpiresAt: timestamp({ mode: 'date' }),
    accountId: text().notNull(),
    createdAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
    id: idColumn().primaryKey(),
    idToken: text(),
    password: text(),
    providerId: text().notNull(),
    refreshToken: text(),
    refreshTokenExpiresAt: timestamp({ mode: 'date' }),
    scope: text(),
    updatedAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('account_providerId_accountId_key').on(table.providerId, table.accountId),
  ],
);

export const post = pgTable(
  'Post',
  {
    authorId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    content: text().notNull(),
    createdAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
    id: idColumn().primaryKey(),
    likes: integer().notNull().default(0),
    title: text().notNull(),
    updatedAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('Post_authorId_idx').on(table.authorId)],
);

export const comment = pgTable(
  'Comment',
  {
    authorId: text().references(() => user.id, { onDelete: 'set null' }),
    content: text().notNull(),
    createdAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
    id: idColumn().primaryKey(),
    postId: text()
      .notNull()
      .references(() => post.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('Comment_authorId_idx').on(table.authorId),
    index('Comment_postId_idx').on(table.postId),
  ],
);

export const userRelations = relations(user, ({ many }) => ({
  accounts: many(account),
  comments: many(comment),
  posts: many(post),
  sessions: many(session),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const postRelations = relations(post, ({ many, one }) => ({
  author: one(user, {
    fields: [post.authorId],
    references: [user.id],
  }),
  comments: many(comment),
}));

export const commentRelations = relations(comment, ({ one }) => ({
  author: one(user, {
    fields: [comment.authorId],
    references: [user.id],
  }),
  post: one(post, {
    fields: [comment.postId],
    references: [post.id],
  }),
}));

const schema = {
  account,
  accountRelations,
  comment,
  commentRelations,
  post,
  postRelations,
  session,
  sessionRelations,
  user,
  userRelations,
};

export default schema;

export type CommentRow = typeof comment.$inferSelect;
export type PostRow = typeof post.$inferSelect;
export type UserRow = typeof user.$inferSelect;
