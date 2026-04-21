import { randomUUID } from 'node:crypto';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const idColumn = () =>
  text()
    .notNull()
    .$defaultFn(() => randomUUID());

export const rsvpStatus = pgEnum('RSVPStatus', ['INVITED', 'GOING', 'INTERESTED', 'DECLINED']);
export const eventType = pgEnum('EventType', [
  'WORKSHOP',
  'MEETUP',
  'AMA',
  'LAUNCH',
  'COMMUNITY_CALL',
]);

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

export const category = pgTable(
  'Category',
  {
    createdAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
    description: text(),
    id: idColumn().primaryKey(),
    name: text().notNull(),
  },
  (table) => [uniqueIndex('Category_name_key').on(table.name)],
);

export const tag = pgTable(
  'Tag',
  {
    createdAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
    description: text(),
    id: idColumn().primaryKey(),
    name: text().notNull(),
  },
  (table) => [uniqueIndex('Tag_name_key').on(table.name)],
);

export const post = pgTable(
  'Post',
  {
    authorId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    categoryId: text().references(() => category.id, { onDelete: 'set null' }),
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

export const event = pgTable(
  'Event',
  {
    capacity: integer().notNull(),
    createdAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
    description: text().notNull(),
    endAt: timestamp({ mode: 'date' }).notNull(),
    hostId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    id: idColumn().primaryKey(),
    livestreamUrl: text(),
    location: text().notNull(),
    name: text().notNull(),
    startAt: timestamp({ mode: 'date' }).notNull(),
    topics: text()
      .array()
      .notNull()
      .default(sql`ARRAY[]::TEXT[]`),
    type: eventType().notNull().default('MEETUP'),
    updatedAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('Event_hostId_idx').on(table.hostId)],
);

export const eventAttendee = pgTable(
  'EventAttendee',
  {
    createdAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
    eventId: text()
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    id: idColumn().primaryKey(),
    notes: text(),
    status: rsvpStatus().notNull().default('INVITED'),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('EventAttendee_eventId_userId_key').on(table.eventId, table.userId),
    index('EventAttendee_userId_idx').on(table.userId),
  ],
);

export const postToTag = pgTable(
  '_PostTags',
  {
    postId: text('A')
      .notNull()
      .references(() => post.id, { onDelete: 'cascade' }),
    tagId: text('B')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.tagId], name: '_PostTags_AB_pkey' }),
    index('_PostTags_B_index').on(table.tagId),
  ],
);

export const userRelations = relations(user, ({ many }) => ({
  accounts: many(account),
  comments: many(comment),
  eventAttendance: many(eventAttendee),
  hostedEvents: many(event, { relationName: 'EventHost' }),
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

export const categoryRelations = relations(category, ({ many }) => ({
  posts: many(post),
}));

export const tagRelations = relations(tag, ({ many }) => ({
  postLinks: many(postToTag),
}));

export const postRelations = relations(post, ({ many, one }) => ({
  author: one(user, {
    fields: [post.authorId],
    references: [user.id],
  }),
  category: one(category, {
    fields: [post.categoryId],
    references: [category.id],
  }),
  comments: many(comment),
  postLinks: many(postToTag),
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

export const eventRelations = relations(event, ({ many, one }) => ({
  attendees: many(eventAttendee),
  host: one(user, {
    fields: [event.hostId],
    references: [user.id],
    relationName: 'EventHost',
  }),
}));

export const eventAttendeeRelations = relations(eventAttendee, ({ one }) => ({
  event: one(event, {
    fields: [eventAttendee.eventId],
    references: [event.id],
  }),
  user: one(user, {
    fields: [eventAttendee.userId],
    references: [user.id],
  }),
}));

export const postToTagRelations = relations(postToTag, ({ one }) => ({
  post: one(post, {
    fields: [postToTag.postId],
    references: [post.id],
  }),
  tag: one(tag, {
    fields: [postToTag.tagId],
    references: [tag.id],
  }),
}));

export type UserRow = typeof user.$inferSelect;
export type SessionRow = typeof session.$inferSelect;
export type AccountRow = typeof account.$inferSelect;
export type CategoryRow = typeof category.$inferSelect;
export type TagRow = typeof tag.$inferSelect;
export type PostRow = typeof post.$inferSelect;
export type CommentRow = typeof comment.$inferSelect;
export type EventRow = typeof event.$inferSelect;
export type EventAttendeeRow = typeof eventAttendee.$inferSelect;
export type RSVPStatus = (typeof rsvpStatus.enumValues)[number];
export type EventType = (typeof eventType.enumValues)[number];

const schema = {
  account,
  accountRelations,
  category,
  categoryRelations,
  comment,
  commentRelations,
  event,
  eventAttendee,
  eventAttendeeRelations,
  eventRelations,
  eventType,
  post,
  postRelations,
  postToTag,
  postToTagRelations,
  rsvpStatus,
  session,
  sessionRelations,
  tag,
  tagRelations,
  user,
  userRelations,
} as const;

export default schema;
