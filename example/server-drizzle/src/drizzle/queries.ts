import {
  attachComputedState,
  type ConnectionResult,
  type ExecutionPlanNode,
} from '@nkzw/fate/server';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import db from './db.ts';
import {
  category,
  comment,
  event,
  eventAttendee,
  post,
  postToTag,
  tag,
  user,
  type CategoryRow,
  type CommentRow,
  type EventAttendeeRow,
  type EventRow,
  type PostRow,
  type TagRow,
  type UserRow,
} from './schema.ts';

type ItemRecord = Record<string, unknown>;
type PlanNode = ExecutionPlanNode<unknown>;

type PaginationArgs = {
  after?: string;
  before?: string;
  first?: number;
  last?: number;
};

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

const relation = (node: PlanNode, field: string): PlanNode | undefined =>
  node.relations.get(field) as PlanNode | undefined;

const paginationArgs = (args?: Record<string, unknown>): PaginationArgs => ({
  after: typeof args?.after === 'string' ? args.after : undefined,
  before: typeof args?.before === 'string' ? args.before : undefined,
  first: typeof args?.first === 'number' ? args.first : undefined,
  last: typeof args?.last === 'number' ? args.last : undefined,
});

const hasPagination = (args?: Record<string, unknown>) => {
  const value = paginationArgs(args);
  return (
    value.after !== undefined ||
    value.before !== undefined ||
    value.first !== undefined ||
    value.last !== undefined
  );
};

const getConnectionDirection = (args?: Record<string, unknown>) =>
  args?.before !== undefined || typeof args?.last === 'number' ? 'backward' : 'forward';

const getConnectionSize = (fallback: number, args?: Record<string, unknown>) =>
  (typeof args?.first === 'number' ? args.first : undefined) ??
  (typeof args?.last === 'number' ? args.last : undefined) ??
  fallback;

const buildConnection = <TNode extends { id: string }>({
  cursor,
  direction,
  items,
  pageSize,
}: {
  cursor?: string;
  direction: 'backward' | 'forward';
  items: Array<TNode>;
  pageSize: number;
}): ConnectionResult<TNode> => {
  const hasMore = items.length > pageSize;
  const limitedItems = direction === 'forward' ? items.slice(0, pageSize) : items.slice(-pageSize);
  const connectionItems = limitedItems.map((node) => ({
    cursor: node.id,
    node,
  }));
  const firstItem = connectionItems[0];
  const lastItem = connectionItems.at(-1);

  return {
    items: connectionItems,
    pagination: {
      hasNext: direction === 'backward' ? Boolean(cursor) : hasMore,
      hasPrevious: direction === 'backward' ? hasMore : Boolean(cursor),
      nextCursor: lastItem?.cursor,
      previousCursor: (direction === 'backward' ? hasMore : Boolean(cursor))
        ? firstItem?.cursor
        : undefined,
    },
  };
};

const mapById = <T extends { id: string }>(items: Array<T>) =>
  new Map(items.map((item) => [item.id, item]));

const reorderByIds = <T extends { id: string }>(ids: Array<string>, items: Array<T>) => {
  const itemsById = mapById(items);
  return ids.flatMap((id) => {
    const item = itemsById.get(id);
    return item ? [item] : [];
  });
};

const fetchUsersByIds = async (ids: Array<string>) => {
  if (!ids.length) {
    return new Map<string, UserRow>();
  }

  const rows = await db
    .select()
    .from(user)
    .where(inArray(user.id, [...new Set(ids)]));
  return mapById(rows);
};

const fetchCategoryRowsByIds = async (ids: Array<string>) => {
  if (!ids.length) {
    return new Map<string, CategoryRow>();
  }

  const rows = await db
    .select()
    .from(category)
    .where(inArray(category.id, [...new Set(ids)]));
  return mapById(rows);
};

const fetchTagsByPostIds = async (postIds: Array<string>) => {
  if (!postIds.length) {
    return new Map<string, Array<TagRow>>();
  }

  const rows = await db
    .select({
      postId: postToTag.postId,
      tag,
    })
    .from(postToTag)
    .innerJoin(tag, eq(postToTag.tagId, tag.id))
    .where(inArray(postToTag.postId, [...new Set(postIds)]))
    .orderBy(asc(tag.name), asc(tag.id));

  const tagsByPostId = new Map<string, Array<TagRow>>();

  for (const row of rows) {
    const items = tagsByPostId.get(row.postId) ?? [];
    items.push(row.tag);
    tagsByPostId.set(row.postId, items);
  }

  return tagsByPostId;
};

const fetchCommentCountsByPostIds = async (postIds: Array<string>) => {
  if (!postIds.length) {
    return new Map<string, number>();
  }

  const rows = await db
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      postId: comment.postId,
    })
    .from(comment)
    .where(inArray(comment.postId, [...new Set(postIds)]))
    .groupBy(comment.postId);

  return new Map(rows.map((row) => [row.postId, row.count]));
};

const fetchPostCountsByCategoryIds = async (categoryIds: Array<string>) => {
  if (!categoryIds.length) {
    return new Map<string, number>();
  }

  const rows = await db
    .select({
      categoryId: post.categoryId,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(post)
    .where(inArray(post.categoryId, [...new Set(categoryIds)]))
    .groupBy(post.categoryId);

  return new Map(
    rows.flatMap((row) => (row.categoryId ? [[row.categoryId, row.count] as const] : [])),
  );
};

const fetchAttendingCountsByEventIds = async (eventIds: Array<string>) => {
  if (!eventIds.length) {
    return new Map<string, number>();
  }

  const rows = await db
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      eventId: eventAttendee.eventId,
    })
    .from(eventAttendee)
    .where(
      and(
        inArray(eventAttendee.eventId, [...new Set(eventIds)]),
        eq(eventAttendee.status, 'GOING'),
      ),
    )
    .groupBy(eventAttendee.eventId);

  return new Map(rows.map((row) => [row.eventId, row.count]));
};

const dateIdCursorWhere = (
  naturalOrder: 'asc' | 'desc',
  direction: 'backward' | 'forward',
  cursorDate: Date,
  cursorId: string,
  dateColumn: any,
  idColumn: any,
) => {
  const moveForward =
    naturalOrder === 'asc'
      ? or(
          sql`${dateColumn} > ${cursorDate}`,
          and(eq(dateColumn, cursorDate), sql`${idColumn} > ${cursorId}`),
        )
      : or(
          sql`${dateColumn} < ${cursorDate}`,
          and(eq(dateColumn, cursorDate), sql`${idColumn} < ${cursorId}`),
        );

  const moveBackward =
    naturalOrder === 'asc'
      ? or(
          sql`${dateColumn} < ${cursorDate}`,
          and(eq(dateColumn, cursorDate), sql`${idColumn} < ${cursorId}`),
        )
      : or(
          sql`${dateColumn} > ${cursorDate}`,
          and(eq(dateColumn, cursorDate), sql`${idColumn} > ${cursorId}`),
        );

  return direction === 'forward' ? moveForward : moveBackward;
};

const queryDateIdPage = async <TRow extends Record<string, unknown>>({
  baseWhere,
  cursor,
  dateColumn,
  direction,
  idColumn,
  naturalOrder,
  table,
  take,
}: {
  baseWhere?: any;
  cursor?: string;
  dateColumn: any;
  direction: 'backward' | 'forward';
  idColumn: any;
  naturalOrder: 'asc' | 'desc';
  table: any;
  take: number;
}) => {
  let whereClause = baseWhere;

  if (cursor) {
    const [cursorRow] = await db
      .select({
        id: idColumn,
        sort: dateColumn,
      })
      .from(table)
      .where(baseWhere ? and(baseWhere, eq(idColumn, cursor)) : eq(idColumn, cursor))
      .limit(1);

    if (cursorRow) {
      const cursorWhere = dateIdCursorWhere(
        naturalOrder,
        direction,
        cursorRow.sort,
        cursorRow.id,
        dateColumn,
        idColumn,
      );
      whereClause = whereClause ? and(whereClause, cursorWhere) : cursorWhere;
    }
  }

  const orderBy =
    direction === 'forward'
      ? naturalOrder === 'asc'
        ? [asc(dateColumn), asc(idColumn)]
        : [desc(dateColumn), desc(idColumn)]
      : naturalOrder === 'asc'
        ? [desc(dateColumn), desc(idColumn)]
        : [asc(dateColumn), asc(idColumn)];

  const rows = (await db
    .select()
    .from(table)
    .where(whereClause)
    .orderBy(...orderBy)
    .limit(take)) as Array<TRow>;
  return direction === 'backward' ? rows.reverse() : rows;
};

const hydrateComments = async (
  rows: Array<CommentRow>,
  node: PlanNode,
): Promise<Array<CommentItem>> => {
  const items = rows.map((row) => ({ ...row }) as CommentItem);

  if (relation(node, 'author')) {
    const authors = await fetchUsersByIds(
      items.flatMap((item) => (item.authorId ? [item.authorId] : [])),
    );
    for (const item of items) {
      item.author = item.authorId ? (authors.get(item.authorId) ?? null) : null;
    }
  }

  const postNode = relation(node, 'post');
  if (postNode) {
    const posts = await fetchPostsByIds(
      items.flatMap((item) => [item.postId]),
      postNode,
    );
    const postsById = mapById(posts);
    for (const item of items) {
      item.post = postsById.get(item.postId) ?? null;
    }
  }

  return items;
};

const fetchCommentsConnectionForPost = async (
  postId: string,
  node: PlanNode,
): Promise<ConnectionResult<CommentItem>> => {
  const args = paginationArgs(node.args);
  const direction = getConnectionDirection(args);
  const pageSize = getConnectionSize(20, args);
  const cursor = direction === 'forward' ? args.after : args.before;
  const rows = await queryDateIdPage<CommentRow>({
    baseWhere: eq(comment.postId, postId),
    cursor,
    dateColumn: comment.createdAt,
    direction,
    idColumn: comment.id,
    naturalOrder: 'desc',
    table: comment,
    take: pageSize + 1,
  });

  const hydrated = await hydrateComments(rows, node);
  return buildConnection({ cursor, direction, items: hydrated, pageSize });
};

const hydratePosts = async (rows: Array<PostRow>, node: PlanNode): Promise<Array<PostItem>> => {
  const items = rows.map((row) => ({ ...row }) as PostItem);
  const postIds = items.map((item) => item.id);

  if (node.computeds.has('commentCount')) {
    const counts = await fetchCommentCountsByPostIds(postIds);
    for (const item of items) {
      attachComputedState(item, 'commentCount', {
        count: counts.get(item.id) ?? 0,
      });
    }
  }

  if (relation(node, 'author')) {
    const authors = await fetchUsersByIds(items.map((item) => item.authorId));
    for (const item of items) {
      item.author = authors.get(item.authorId) ?? null;
    }
  }

  if (relation(node, 'category')) {
    const categories = await fetchCategoryRowsByIds(
      items.flatMap((item) => (item.categoryId ? [item.categoryId] : [])),
    );
    for (const item of items) {
      item.category = item.categoryId ? (categories.get(item.categoryId) ?? null) : null;
    }
  }

  if (relation(node, 'tags')) {
    const tagsByPostId = await fetchTagsByPostIds(postIds);
    for (const item of items) {
      item.tags = tagsByPostId.get(item.id) ?? [];
    }
  }

  const commentsNode = relation(node, 'comments');
  if (commentsNode) {
    if (hasPagination(commentsNode.args)) {
      const connections = await Promise.all(
        items.map(
          async (item) =>
            [item.id, await fetchCommentsConnectionForPost(item.id, commentsNode)] as const,
        ),
      );
      const connectionByPostId = new Map(connections);
      for (const item of items) {
        (item as ItemRecord).comments = connectionByPostId.get(item.id);
      }
    } else {
      const rows = await db
        .select()
        .from(comment)
        .where(inArray(comment.postId, postIds))
        .orderBy(desc(comment.createdAt), desc(comment.id));
      const hydrated = await hydrateComments(rows, commentsNode);
      const commentsByPostId = new Map<string, Array<CommentItem>>();

      for (const item of hydrated) {
        const entries = commentsByPostId.get(item.postId) ?? [];
        entries.push(item);
        commentsByPostId.set(item.postId, entries);
      }

      for (const item of items) {
        item.comments = commentsByPostId.get(item.id) ?? [];
      }
    }
  }

  return items;
};

const hydrateCategories = async (
  rows: Array<CategoryRow>,
  node: PlanNode,
): Promise<Array<CategoryItem>> => {
  const items = rows.map((row) => ({ ...row }) as CategoryItem);

  if (node.computeds.has('postCount')) {
    const counts = await fetchPostCountsByCategoryIds(items.map((item) => item.id));
    for (const item of items) {
      attachComputedState(item, 'postCount', {
        count: counts.get(item.id) ?? 0,
      });
    }
  }

  const postsNode = relation(node, 'posts');
  if (postsNode) {
    const rows = await db
      .select()
      .from(post)
      .where(
        inArray(
          post.categoryId,
          items.map((item) => item.id),
        ),
      )
      .orderBy(desc(post.createdAt), desc(post.id));
    const hydrated = await hydratePosts(rows, postsNode);
    const postsByCategoryId = new Map<string, Array<PostItem>>();

    for (const item of hydrated) {
      if (!item.categoryId) {
        continue;
      }
      const entries = postsByCategoryId.get(item.categoryId) ?? [];
      entries.push(item);
      postsByCategoryId.set(item.categoryId, entries);
    }

    for (const item of items) {
      item.posts = postsByCategoryId.get(item.id) ?? [];
    }
  }

  return items;
};

const hydrateEventAttendees = async (
  rows: Array<EventAttendeeRow>,
  node: PlanNode,
): Promise<Array<EventAttendeeItem>> => {
  const items = rows.map((row) => ({ ...row }) as EventAttendeeItem);

  if (relation(node, 'user')) {
    const users = await fetchUsersByIds(items.map((item) => item.userId));
    for (const item of items) {
      item.user = users.get(item.userId) ?? null;
    }
  }

  return items;
};

const hydrateEvents = async (rows: Array<EventRow>, node: PlanNode): Promise<Array<EventItem>> => {
  const items = rows.map((row) => ({ ...row }) as EventItem);
  const eventIds = items.map((item) => item.id);

  if (node.computeds.has('attendingCount')) {
    const counts = await fetchAttendingCountsByEventIds(eventIds);
    for (const item of items) {
      attachComputedState(item, 'attendingCount', {
        count: counts.get(item.id) ?? 0,
      });
    }
  }

  if (relation(node, 'host')) {
    const users = await fetchUsersByIds(items.map((item) => item.hostId));
    for (const item of items) {
      item.host = users.get(item.hostId) ?? null;
    }
  }

  const attendeesNode = relation(node, 'attendees');
  if (attendeesNode) {
    const rows = await db
      .select()
      .from(eventAttendee)
      .where(inArray(eventAttendee.eventId, eventIds))
      .orderBy(asc(eventAttendee.createdAt), asc(eventAttendee.id));
    const hydrated = await hydrateEventAttendees(rows, attendeesNode);
    const attendeesByEventId = new Map<string, Array<EventAttendeeItem>>();

    for (const item of hydrated) {
      const entries = attendeesByEventId.get(item.eventId) ?? [];
      entries.push(item);
      attendeesByEventId.set(item.eventId, entries);
    }

    for (const item of items) {
      item.attendees = attendeesByEventId.get(item.id) ?? [];
    }
  }

  return items;
};

export const getUserById = async (id: string) => {
  const users = await fetchUsersByIds([id]);
  return users.get(id) ?? null;
};

export const getTagsByIds = async (ids: Array<string>) => {
  if (!ids.length) {
    return [];
  }

  const rows = await db
    .select()
    .from(tag)
    .where(inArray(tag.id, [...new Set(ids)]));
  return reorderByIds(ids, rows);
};

export const fetchPostsByIds = async (ids: Array<string>, node: PlanNode) => {
  if (!ids.length) {
    return [];
  }

  const rows = await db
    .select()
    .from(post)
    .where(inArray(post.id, [...new Set(ids)]));
  return reorderByIds(ids, await hydratePosts(rows, node));
};

export const fetchPostById = async (id: string, node: PlanNode) => {
  const posts = await fetchPostsByIds([id], node);
  return posts[0] ?? null;
};

export const fetchPostsConnection = async ({
  cursor,
  direction,
  node,
  take,
}: {
  cursor?: string;
  direction: 'backward' | 'forward';
  node: PlanNode;
  take: number;
}) => {
  const rows = await queryDateIdPage<PostRow>({
    cursor,
    dateColumn: post.createdAt,
    direction,
    idColumn: post.id,
    naturalOrder: 'desc',
    table: post,
    take,
  });
  return hydratePosts(rows, node);
};

export const fetchCategoriesByIds = async (ids: Array<string>, node: PlanNode) => {
  if (!ids.length) {
    return [];
  }

  const rows = await db
    .select()
    .from(category)
    .where(inArray(category.id, [...new Set(ids)]));
  return reorderByIds(ids, await hydrateCategories(rows, node));
};

export const fetchCategoriesConnection = async ({
  cursor,
  direction,
  node,
  take,
}: {
  cursor?: string;
  direction: 'backward' | 'forward';
  node: PlanNode;
  take: number;
}) => {
  const rows = await queryDateIdPage<CategoryRow>({
    cursor,
    dateColumn: category.createdAt,
    direction,
    idColumn: category.id,
    naturalOrder: 'asc',
    table: category,
    take,
  });
  return hydrateCategories(rows, node);
};

export const fetchCommentsByIds = async (ids: Array<string>, node: PlanNode) => {
  if (!ids.length) {
    return [];
  }

  const rows = await db
    .select()
    .from(comment)
    .where(inArray(comment.id, [...new Set(ids)]));
  return reorderByIds(ids, await hydrateComments(rows, node));
};

export const fetchCommentById = async (id: string, node: PlanNode) => {
  const comments = await fetchCommentsByIds([id], node);
  return comments[0] ?? null;
};

export const searchCommentsConnection = async ({
  cursor,
  direction,
  node,
  query,
  take,
}: {
  cursor?: string;
  direction: 'backward' | 'forward';
  node: PlanNode;
  query: string;
  take: number;
}) => {
  const whereClause = ilike(comment.content, `%${query}%`);
  const rows = await queryDateIdPage<CommentRow>({
    baseWhere: whereClause,
    cursor,
    dateColumn: comment.createdAt,
    direction,
    idColumn: comment.id,
    naturalOrder: 'desc',
    table: comment,
    take,
  });
  return hydrateComments(rows, node);
};

export const fetchEventsByIds = async (ids: Array<string>, node: PlanNode) => {
  if (!ids.length) {
    return [];
  }

  const rows = await db
    .select()
    .from(event)
    .where(inArray(event.id, [...new Set(ids)]));
  return reorderByIds(ids, await hydrateEvents(rows, node));
};

export const fetchEventById = async (id: string, node: PlanNode) => {
  const events = await fetchEventsByIds([id], node);
  return events[0] ?? null;
};

export const fetchEventsConnection = async ({
  cursor,
  direction,
  node,
  take,
}: {
  cursor?: string;
  direction: 'backward' | 'forward';
  node: PlanNode;
  take: number;
}) => {
  const rows = await queryDateIdPage<EventRow>({
    cursor,
    dateColumn: event.startAt,
    direction,
    idColumn: event.id,
    naturalOrder: 'asc',
    table: event,
    take,
  });
  return hydrateEvents(rows, node);
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
  const [row] = await db.select().from(post).where(eq(post.id, id)).limit(1);
  if (!row) {
    return false;
  }

  await db
    .update(post)
    .set({
      likes: row.likes + 1,
      updatedAt: new Date(),
    })
    .where(eq(post.id, id));

  return true;
};

export const unlikePostRecord = async (id: string) => {
  const [row] = await db.select().from(post).where(eq(post.id, id)).limit(1);
  if (!row) {
    return false;
  }

  if (row.likes > 0) {
    await db
      .update(post)
      .set({
        likes: row.likes - 1,
        updatedAt: new Date(),
      })
      .where(eq(post.id, id));
  }

  return true;
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
