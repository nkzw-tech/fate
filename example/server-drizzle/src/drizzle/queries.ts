import {
  attachComputedState,
  type ComputedNeed,
  type ConnectionResult,
  type ExecutionPlanNode,
  type SourceDefinition,
  type SourceRelation,
} from '@nkzw/fate/server';
import { and, asc, desc, eq, gt, ilike, inArray, lt, or, sql } from 'drizzle-orm';
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
type PlanNode = ExecutionPlanNode<any, any>;
type Source = SourceDefinition<ItemRecord, unknown>;
type Relation = SourceRelation<ItemRecord, unknown>;
type ColumnMap = Record<string, any>;

type PaginationArgs = {
  after?: string;
  before?: string;
  first?: number;
  last?: number;
};

type SourceTableConfig = {
  columns: ColumnMap;
  manyToMany?: Record<
    string,
    {
      foreignColumn: any;
      localColumn: any;
      table: any;
    }
  >;
  table: any;
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

const sourceConfigs = {
  Category: {
    columns: {
      createdAt: category.createdAt,
      description: category.description,
      id: category.id,
      name: category.name,
    },
    table: category,
  },
  Comment: {
    columns: {
      authorId: comment.authorId,
      content: comment.content,
      createdAt: comment.createdAt,
      id: comment.id,
      postId: comment.postId,
    },
    table: comment,
  },
  Event: {
    columns: {
      capacity: event.capacity,
      createdAt: event.createdAt,
      description: event.description,
      endAt: event.endAt,
      hostId: event.hostId,
      id: event.id,
      livestreamUrl: event.livestreamUrl,
      location: event.location,
      name: event.name,
      startAt: event.startAt,
      topics: event.topics,
      type: event.type,
      updatedAt: event.updatedAt,
    },
    table: event,
  },
  EventAttendee: {
    columns: {
      createdAt: eventAttendee.createdAt,
      eventId: eventAttendee.eventId,
      id: eventAttendee.id,
      notes: eventAttendee.notes,
      status: eventAttendee.status,
      userId: eventAttendee.userId,
    },
    table: eventAttendee,
  },
  Post: {
    columns: {
      authorId: post.authorId,
      categoryId: post.categoryId,
      content: post.content,
      createdAt: post.createdAt,
      id: post.id,
      likes: post.likes,
      title: post.title,
      updatedAt: post.updatedAt,
    },
    manyToMany: {
      tags: {
        foreignColumn: postToTag.tagId,
        localColumn: postToTag.postId,
        table: postToTag,
      },
    },
    table: post,
  },
  Tag: {
    columns: {
      createdAt: tag.createdAt,
      description: tag.description,
      id: tag.id,
      name: tag.name,
    },
    table: tag,
  },
  User: {
    columns: {
      banExpires: user.banExpires,
      banned: user.banned,
      banReason: user.banReason,
      createdAt: user.createdAt,
      displayUsername: user.displayUsername,
      email: user.email,
      emailVerified: user.emailVerified,
      id: user.id,
      image: user.image,
      name: user.name,
      password: user.password,
      role: user.role,
      updatedAt: user.updatedAt,
      username: user.username,
    },
    table: user,
  },
} satisfies Record<string, SourceTableConfig>;

const resolveSource = (source: Source | (() => Source)): Source =>
  typeof source === 'function' ? source() : source;

const getSourceConfig = (source: Source): SourceTableConfig => {
  const config = sourceConfigs[source.view.typeName as keyof typeof sourceConfigs];
  if (!config) {
    throw new Error(`No Drizzle table registered for source ${source.view.typeName}.`);
  }
  return config;
};

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

const mapByField = <T extends ItemRecord>(items: Array<T>, field: string) =>
  new Map(items.map((item) => [item[field], item]));

const reorderByIds = <T extends { id: string }>(ids: Array<string>, items: Array<T>) => {
  const itemsById = mapByField(items, 'id');
  return ids.flatMap((id) => {
    const item = itemsById.get(id);
    return item ? [item as T] : [];
  });
};

const getColumn = (config: SourceTableConfig, field: string) => {
  const column = config.columns[field];
  if (!column) {
    throw new Error(`No Drizzle column registered for field ${field}.`);
  }
  return column;
};

const addColumnField = (fields: Set<string>, field: string) => {
  if (!field || field === 'cursor') {
    return;
  }
  fields.add(field);
};

const addNeedColumns = (fields: Set<string>, needs?: Record<string, ComputedNeed>) => {
  if (!needs) {
    return;
  }

  for (const need of Object.values(needs)) {
    if (need.kind === 'field') {
      const [field] = need.path.split('.');
      addColumnField(fields, field);
    }
  }
};

const getRequiredFields = (node: PlanNode, extraFields: Array<string> = []) => {
  const fields = new Set<string>(extraFields);
  addColumnField(fields, node.source.id);

  for (const field of node.selectedFields) {
    addColumnField(fields, field);
  }

  for (const order of node.orderBy) {
    addColumnField(fields, order.field);
  }

  for (const computed of node.computeds.values()) {
    addNeedColumns(fields, computed.needs);
  }

  for (const [field] of node.relations) {
    const sourceRelation = node.source.relations?.[field];
    if (sourceRelation) {
      addColumnField(fields, sourceRelation.localKey);
    }
  }

  return fields;
};

const buildSelection = (node: PlanNode, extraFields: Array<string> = []) => {
  const config = getSourceConfig(node.source);
  const selection: Record<string, any> = {};

  for (const field of getRequiredFields(node, extraFields)) {
    selection[field] = getColumn(config, field);
  }

  return selection;
};

const compareColumn = (
  direction: 'backward' | 'forward',
  naturalDirection: 'asc' | 'desc',
  column: any,
  value: unknown,
) => {
  const forward = naturalDirection === 'asc' ? gt(column, value) : lt(column, value);
  const backward = naturalDirection === 'asc' ? lt(column, value) : gt(column, value);
  return direction === 'forward' ? forward : backward;
};

const buildCursorWhere = ({
  columnMap,
  cursorValues,
  direction,
  node,
}: {
  columnMap: ColumnMap;
  cursorValues: Record<string, unknown>;
  direction: 'backward' | 'forward';
  node: PlanNode;
}) => {
  const branches = node.orderBy.map((entry, index) => {
    const column = getColumn({ columns: columnMap, table: null }, entry.field);
    const compare = compareColumn(direction, entry.direction, column, cursorValues[entry.field]);
    const equalities = node.orderBy
      .slice(0, index)
      .map((previous) =>
        eq(
          getColumn({ columns: columnMap, table: null }, previous.field),
          cursorValues[previous.field],
        ),
      );

    return equalities.length ? and(...equalities, compare) : compare;
  });

  return branches.length === 1 ? branches[0] : or(...branches);
};

const getQueryOrder = (direction: 'backward' | 'forward', node: PlanNode, columnMap: ColumnMap) =>
  node.orderBy.map((entry) => {
    const column = getColumn({ columns: columnMap, table: null }, entry.field);
    return direction === 'forward'
      ? entry.direction === 'asc'
        ? asc(column)
        : desc(column)
      : entry.direction === 'asc'
        ? desc(column)
        : asc(column);
  });

const whereFromObject = (columns: ColumnMap, where?: ItemRecord) => {
  if (!where || Object.keys(where).length === 0) {
    return undefined;
  }

  const conditions = Object.entries(where).map(([field, value]) =>
    eq(getColumn({ columns, table: null }, field), value),
  );
  return conditions.length === 1 ? conditions[0] : and(...conditions);
};

const queryRows = async ({
  extraFields,
  node,
  where,
}: {
  extraFields?: Array<string>;
  node: PlanNode;
  where?: any;
}) => {
  const config = getSourceConfig(node.source);
  return (await db
    .select(buildSelection(node, extraFields))
    .from(config.table)
    .where(where)
    .orderBy(...getQueryOrder('forward', node, config.columns))) as Array<ItemRecord>;
};

const queryNodePage = async ({
  baseWhere,
  cursor,
  direction,
  node,
  take,
}: {
  baseWhere?: any;
  cursor?: string;
  direction: 'backward' | 'forward';
  node: PlanNode;
  take: number;
}) => {
  const config = getSourceConfig(node.source);
  let whereClause = baseWhere;

  if (cursor) {
    const cursorSelection = Object.fromEntries(
      node.orderBy.map((entry) => [entry.field, getColumn(config, entry.field)]),
    );
    const [cursorRow] = await db
      .select(cursorSelection)
      .from(config.table)
      .where(
        baseWhere
          ? and(baseWhere, eq(getColumn(config, node.source.id), cursor))
          : eq(getColumn(config, node.source.id), cursor),
      )
      .limit(1);

    if (cursorRow) {
      const cursorWhere = buildCursorWhere({
        columnMap: config.columns,
        cursorValues: cursorRow,
        direction,
        node,
      });
      whereClause = whereClause ? and(whereClause, cursorWhere) : cursorWhere;
    }
  }

  const rows = (await db
    .select(buildSelection(node))
    .from(config.table)
    .where(whereClause)
    .orderBy(...getQueryOrder(direction, node, config.columns))
    .limit(take)) as Array<ItemRecord>;
  return direction === 'backward' ? rows.reverse() : rows;
};

const attachComputedCounts = async (items: Array<ItemRecord>, node: PlanNode) => {
  if (items.length === 0) {
    return;
  }

  for (const [field, computed] of node.computeds) {
    if (!computed.needs) {
      continue;
    }

    for (const [needName, need] of Object.entries(computed.needs)) {
      if (need.kind !== 'count') {
        continue;
      }

      const sourceRelation = node.source.relations?.[need.relation];
      if (!sourceRelation || sourceRelation.kind !== 'many') {
        throw new Error(
          `Computed count ${node.source.view.typeName}.${field} requires a 'many' relation named ${need.relation}.`,
        );
      }

      const childSource = resolveSource(sourceRelation.source);
      const childConfig = getSourceConfig(childSource);
      const parentKeys = [
        ...new Set(items.map((item) => item[sourceRelation.localKey]).filter(Boolean)),
      ];
      const where = and(
        inArray(getColumn(childConfig, sourceRelation.foreignKey), parentKeys),
        whereFromObject(childConfig.columns, need.where),
      );
      const rows = await db
        .select({
          count: sql<number>`count(*)`.mapWith(Number),
          parentKey: getColumn(childConfig, sourceRelation.foreignKey),
        })
        .from(childConfig.table)
        .where(where)
        .groupBy(getColumn(childConfig, sourceRelation.foreignKey));
      const counts = new Map(rows.map((row) => [row.parentKey, row.count]));

      for (const item of items) {
        attachComputedState(item, field, {
          [needName]: counts.get(item[sourceRelation.localKey]) ?? 0,
        });
      }
    }
  }
};

const fetchManyRelation = async ({
  items,
  relationNode,
  sourceRelation,
}: {
  items: Array<ItemRecord>;
  relationNode: PlanNode;
  sourceRelation: Relation;
}) => {
  const childSource = resolveSource(sourceRelation.source);
  const childConfig = getSourceConfig(childSource);
  const parentKeys = [
    ...new Set(items.map((item) => item[sourceRelation.localKey]).filter(Boolean)),
  ];

  if (parentKeys.length === 0) {
    return new Map<unknown, Array<ItemRecord>>();
  }

  const rows = await queryRows({
    extraFields: [sourceRelation.foreignKey],
    node: relationNode,
    where: inArray(getColumn(childConfig, sourceRelation.foreignKey), parentKeys),
  });
  const hydrated = await hydrateRows(rows, relationNode);
  const byParentKey = new Map<unknown, Array<ItemRecord>>();

  for (const item of hydrated) {
    const key = item[sourceRelation.foreignKey];
    const entries = byParentKey.get(key) ?? [];
    entries.push(item);
    byParentKey.set(key, entries);
  }

  return byParentKey;
};

const fetchManyConnection = async (
  parentKey: unknown,
  relationNode: PlanNode,
  sourceRelation: Relation,
): Promise<ConnectionResult<ItemRecord>> => {
  const childConfig = getSourceConfig(resolveSource(sourceRelation.source));
  const args = paginationArgs(relationNode.args);
  const direction = getConnectionDirection(args);
  const pageSize = getConnectionSize(20, args);
  const cursor = direction === 'forward' ? args.after : args.before;
  const rows = await queryNodePage({
    baseWhere: eq(getColumn(childConfig, sourceRelation.foreignKey), parentKey),
    cursor,
    direction,
    node: relationNode,
    take: pageSize + 1,
  });
  const hydrated = await hydrateRows(rows, relationNode);
  return buildConnection({
    cursor,
    direction,
    items: hydrated as Array<ItemRecord & { id: string }>,
    pageSize,
  });
};

const fetchManyToManyRelation = async ({
  items,
  node,
  relationField,
  relationNode,
  sourceRelation,
}: {
  items: Array<ItemRecord>;
  node: PlanNode;
  relationField: string;
  relationNode: PlanNode;
  sourceRelation: Relation;
}) => {
  const parentConfig = getSourceConfig(node.source);
  const childConfig = getSourceConfig(resolveSource(sourceRelation.source));
  const through = parentConfig.manyToMany?.[relationField];

  if (!through) {
    throw new Error(
      `No Drizzle many-to-many table registered for ${node.source.view.typeName}.${relationField}.`,
    );
  }

  const parentKeys = [
    ...new Set(items.map((item) => item[sourceRelation.localKey]).filter(Boolean)),
  ];
  if (parentKeys.length === 0) {
    return new Map<unknown, Array<ItemRecord>>();
  }

  const rows = (await db
    .select({
      ...buildSelection(relationNode),
      parentKey: through.localColumn,
    })
    .from(through.table)
    .innerJoin(
      childConfig.table,
      eq(through.foreignColumn, getColumn(childConfig, sourceRelation.foreignKey)),
    )
    .where(inArray(through.localColumn, parentKeys))
    .orderBy(...getQueryOrder('forward', relationNode, childConfig.columns))) as Array<
    ItemRecord & { parentKey: unknown }
  >;
  const hydrated = await hydrateRows(rows, relationNode);
  const byParentKey = new Map<unknown, Array<ItemRecord>>();

  for (const item of hydrated) {
    const entries = byParentKey.get(item.parentKey) ?? [];
    entries.push(item);
    byParentKey.set(item.parentKey, entries);
  }

  return byParentKey;
};

const hydrateRows = async (rows: Array<ItemRecord>, node: PlanNode): Promise<Array<ItemRecord>> => {
  const items = rows.map((row) => ({ ...row }));

  await attachComputedCounts(items, node);

  for (const [field, relationNode] of node.relations) {
    const sourceRelation = node.source.relations?.[field];
    if (!sourceRelation) {
      continue;
    }

    if (sourceRelation.kind === 'one') {
      const childConfig = getSourceConfig(resolveSource(sourceRelation.source));
      const childKeys = [
        ...new Set(items.map((item) => item[sourceRelation.localKey]).filter(Boolean)),
      ];
      const childRows = childKeys.length
        ? await queryRows({
            node: relationNode,
            where: inArray(getColumn(childConfig, sourceRelation.foreignKey), childKeys),
          })
        : [];
      const children = await hydrateRows(childRows, relationNode);
      const childByKey = mapByField(children, sourceRelation.foreignKey);

      for (const item of items) {
        const localKey = item[sourceRelation.localKey];
        item[field] = localKey
          ? ((childByKey.get(localKey) as ItemRecord | undefined) ?? null)
          : null;
      }
      continue;
    }

    if (sourceRelation.kind === 'manyToMany') {
      const byParentKey = await fetchManyToManyRelation({
        items,
        node,
        relationField: field,
        relationNode,
        sourceRelation,
      });

      for (const item of items) {
        item[field] = byParentKey.get(item[sourceRelation.localKey]) ?? [];
      }
      continue;
    }

    if (hasPagination(relationNode.args)) {
      const connections = await Promise.all(
        items.map(
          async (item) =>
            [
              item[sourceRelation.localKey],
              await fetchManyConnection(
                item[sourceRelation.localKey],
                relationNode,
                sourceRelation,
              ),
            ] as const,
        ),
      );
      const connectionByParentKey = new Map(connections);

      for (const item of items) {
        item[field] = connectionByParentKey.get(item[sourceRelation.localKey]);
      }
      continue;
    }

    const byParentKey = await fetchManyRelation({
      items,
      relationNode,
      sourceRelation,
    });

    for (const item of items) {
      item[field] = byParentKey.get(item[sourceRelation.localKey]) ?? [];
    }
  }

  return items;
};

const fetchByIds = async (ids: Array<string>, node: PlanNode, extraFields: Array<string> = []) => {
  if (!ids.length) {
    return [];
  }

  const config = getSourceConfig(node.source);
  const rows = await queryRows({
    extraFields,
    node,
    where: inArray(getColumn(config, node.source.id), [...new Set(ids)]),
  });
  return reorderByIds(ids, (await hydrateRows(rows, node)) as Array<ItemRecord & { id: string }>);
};

const fetchById = async (id: string, node: PlanNode, extraFields: Array<string> = []) =>
  (await fetchByIds([id], node, extraFields))[0] ?? null;

const fetchConnection = async ({
  cursor,
  direction,
  node,
  take,
  where,
}: {
  cursor?: string;
  direction: 'backward' | 'forward';
  node: PlanNode;
  take: number;
  where?: any;
}) => hydrateRows(await queryNodePage({ baseWhere: where, cursor, direction, node, take }), node);

export const fetchUsersByIds = async (ids: Array<string>, node: PlanNode) =>
  fetchByIds(ids, node) as Promise<Array<UserRow & ItemRecord>>;

export const fetchUserById = async (id: string, node: PlanNode) =>
  fetchById(id, node) as Promise<(UserRow & ItemRecord) | null>;

export const fetchTagsByIds = async (ids: Array<string>, node: PlanNode) =>
  fetchByIds(ids, node) as Promise<Array<TagRow>>;

export const fetchTagById = async (id: string, node: PlanNode) =>
  fetchById(id, node) as Promise<TagRow | null>;

export const fetchPostsByIds = async (ids: Array<string>, node: PlanNode) =>
  fetchByIds(ids, node) as Promise<Array<PostItem>>;

export const fetchPostById = async (id: string, node: PlanNode) =>
  fetchById(id, node) as Promise<PostItem | null>;

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
}) => fetchConnection({ cursor, direction, node, take });

export const fetchCategoriesByIds = async (ids: Array<string>, node: PlanNode) =>
  fetchByIds(ids, node) as Promise<Array<CategoryItem>>;

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
}) => fetchConnection({ cursor, direction, node, take });

export const fetchCommentsByIds = async (ids: Array<string>, node: PlanNode) =>
  fetchByIds(ids, node, ['authorId', 'postId']) as Promise<Array<CommentItem>>;

export const fetchCommentById = async (id: string, node: PlanNode) =>
  fetchById(id, node, ['authorId', 'postId']) as Promise<CommentItem | null>;

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
}) =>
  fetchConnection({
    cursor,
    direction,
    node,
    take,
    where: ilike(comment.content, `%${query}%`),
  });

export const fetchEventsByIds = async (ids: Array<string>, node: PlanNode) =>
  fetchByIds(ids, node) as Promise<Array<EventItem>>;

export const fetchEventById = async (id: string, node: PlanNode) =>
  fetchById(id, node) as Promise<EventItem | null>;

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
}) => fetchConnection({ cursor, direction, node, take });

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
