import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { expect, test } from 'vite-plus/test';
import { dataView, list } from '../dataView.ts';
import { createDrizzleSourceRuntime } from '../drizzle.ts';
import { createExecutionPlan, defineSource } from '../source.ts';

test('Drizzle many-to-many relations infer join columns from source through keys', async () => {
  const postTable = pgTable('Post', {
    id: text('id').notNull(),
  });
  const tagTable = pgTable('Tag', {
    id: text('id').notNull(),
    name: text('name').notNull(),
  });
  const postToTagTable = pgTable('_PostTags', {
    postId: text('A').notNull(),
    tagId: text('B').notNull(),
  });

  const tagView = dataView<{ id: string; name: string }>('Tag')({
    id: true,
    name: true,
  });
  const postView = dataView<{ id: string; tags?: Array<{ id: string; name: string }> }>('Post')({
    id: true,
    tags: list(tagView),
  });

  const tagSource = defineSource(tagView, {
    id: 'id',
  });
  const postSource = defineSource(postView, {
    id: 'id',
    relations: {
      tags: {
        foreignKey: 'id',
        kind: 'manyToMany',
        localKey: 'id',
        source: () => tagSource,
        through: {
          foreignKey: 'tagId',
          localKey: 'postId',
        },
      },
    },
  });

  const db = {
    select: () => ({
      from: (table: unknown) => {
        const builder = {
          innerJoin: () => builder,
          orderBy: () =>
            table === postTable
              ? [{ id: 'post-1' }]
              : [
                  {
                    id: 'tag-1',
                    name: 'TypeScript',
                    parentKey: 'post-1',
                  },
                ],
          where: () => builder,
        };

        return builder;
      },
    }),
  };

  const runtime = createDrizzleSourceRuntime({
    db,
    sources: [
      {
        manyToMany: {
          tags: postToTagTable,
        },
        source: postSource,
        table: postTable,
      },
      {
        source: tagSource,
        table: tagTable,
      },
    ],
  });
  const plan = createExecutionPlan({
    select: ['tags.name'],
    source: postSource,
  });

  const items = await runtime.fetchByIds({
    ids: ['post-1'],
    plan,
  });

  expect(await plan.resolveMany(items)).toEqual([
    {
      id: 'post-1',
      tags: {
        items: [
          {
            cursor: 'tag-1',
            node: {
              id: 'tag-1',
              name: 'TypeScript',
            },
          },
        ],
        pagination: {
          hasNext: false,
          hasPrevious: false,
          nextCursor: undefined,
          previousCursor: undefined,
        },
      },
    },
  ]);
});

test('Drizzle many relations preserve falsy relation keys', async () => {
  const postTable = pgTable('Post', {
    id: text('id').notNull(),
  });
  const commentTable = pgTable('Comment', {
    content: text('content').notNull(),
    id: text('id').notNull(),
    postId: text('postId').notNull(),
  });

  const commentView = dataView<{ content: string; id: string; postId: string }>('Comment')({
    content: true,
    id: true,
  });
  const postView = dataView<{
    comments?: Array<{ content: string; id: string; postId: string }>;
    id: string;
  }>('Post')({
    comments: list(commentView),
    id: true,
  });
  const commentSource = defineSource(commentView, {
    id: 'id',
  });
  const postSource = defineSource(postView, {
    id: 'id',
    relations: {
      comments: {
        foreignKey: 'postId',
        kind: 'many',
        localKey: 'id',
        source: () => commentSource,
      },
    },
  });

  const db = {
    select: () => ({
      from: (table: unknown) => {
        const builder = {
          orderBy: () =>
            table === postTable
              ? [{ id: '' }]
              : [
                  {
                    content: 'comment',
                    id: 'comment-1',
                    postId: '',
                  },
                ],
          where: () => builder,
        };

        return builder;
      },
    }),
  };
  const runtime = createDrizzleSourceRuntime({
    db,
    sources: [
      {
        source: postSource,
        table: postTable,
      },
      {
        source: commentSource,
        table: commentTable,
      },
    ],
  });
  const plan = createExecutionPlan({
    select: ['comments.content'],
    source: postSource,
  });

  const items = await runtime.fetchByIds({
    ids: [''],
    plan,
  });

  expect(await plan.resolveMany(items)).toEqual([
    {
      comments: {
        items: [
          {
            cursor: 'comment-1',
            node: {
              content: 'comment',
              id: 'comment-1',
            },
          },
        ],
        pagination: {
          hasNext: false,
          hasPrevious: false,
          nextCursor: undefined,
          previousCursor: undefined,
        },
      },
      id: '',
    },
  ]);
});

test('Drizzle one relations preserve falsy relation keys', async () => {
  const commentTable = pgTable('Comment', {
    authorId: text('authorId').notNull(),
    id: text('id').notNull(),
  });
  const userTable = pgTable('User', {
    id: text('id').notNull(),
    name: text('name').notNull(),
  });

  const userView = dataView<{ id: string; name: string }>('User')({
    id: true,
    name: true,
  });
  const commentView = dataView<{
    author?: { id: string; name: string } | null;
    authorId: string;
    id: string;
  }>('Comment')({
    author: userView,
    id: true,
  });
  const userSource = defineSource(userView, {
    id: 'id',
  });
  const commentSource = defineSource(commentView, {
    id: 'id',
    relations: {
      author: {
        foreignKey: 'id',
        kind: 'one',
        localKey: 'authorId',
        source: () => userSource,
      },
    },
  });

  const db = {
    select: () => ({
      from: (table: unknown) => {
        const builder = {
          orderBy: () =>
            table === commentTable
              ? [{ authorId: '', id: 'comment-1' }]
              : [
                  {
                    id: '',
                    name: 'Anonymous',
                  },
                ],
          where: () => builder,
        };

        return builder;
      },
    }),
  };
  const runtime = createDrizzleSourceRuntime({
    db,
    sources: [
      {
        source: commentSource,
        table: commentTable,
      },
      {
        source: userSource,
        table: userTable,
      },
    ],
  });
  const plan = createExecutionPlan({
    select: ['author.name'],
    source: commentSource,
  });

  const items = await runtime.fetchByIds({
    ids: ['comment-1'],
    plan,
  });

  expect(await plan.resolveMany(items)).toEqual([
    {
      author: {
        id: '',
        name: 'Anonymous',
      },
      id: 'comment-1',
    },
  ]);
});

test('Drizzle many-to-many relations support nested pagination', async () => {
  const postTable = pgTable('Post', {
    id: text('id').notNull(),
  });
  const tagTable = pgTable('Tag', {
    id: text('id').notNull(),
    name: text('name').notNull(),
  });
  const postToTagTable = pgTable('_PostTags', {
    postId: text('postId').notNull(),
    rank: integer('rank').notNull(),
    tagId: text('tagId').notNull(),
  });

  const tagView = dataView<{ id: string; name: string }>('Tag')({
    id: true,
    name: true,
  });
  const postView = dataView<{ id: string; tags?: Array<{ id: string; name: string }> }>('Post')({
    id: true,
    tags: list(tagView),
  });
  const tagSource = defineSource(tagView, {
    id: 'id',
  });
  const postSource = defineSource(postView, {
    id: 'id',
    relations: {
      tags: {
        foreignKey: 'id',
        kind: 'manyToMany',
        localKey: 'id',
        source: () => tagSource,
        through: {
          foreignKey: 'tagId',
          localKey: 'postId',
        },
      },
    },
  });

  const limits: Array<number> = [];
  const db = {
    select: () => ({
      from: (table: unknown) => {
        const builder = {
          innerJoin: () => builder,
          limit: (take: number) => {
            limits.push(take);
            return table === postTable
              ? [{ id: 'post-1' }]
              : [
                  {
                    id: 'tag-1',
                    name: 'TypeScript',
                    parentKey: 'post-1',
                  },
                  {
                    id: 'tag-2',
                    name: 'Databases',
                    parentKey: 'post-1',
                  },
                ].slice(0, take);
          },
          orderBy: () => (table === postTable ? [{ id: 'post-1' }] : builder),
          where: () => builder,
        };

        return builder;
      },
    }),
  };
  const runtime = createDrizzleSourceRuntime({
    db,
    sources: [
      {
        manyToMany: {
          tags: postToTagTable,
        },
        source: postSource,
        table: postTable,
      },
      {
        source: tagSource,
        table: tagTable,
      },
    ],
  });
  const plan = createExecutionPlan({
    args: {
      tags: {
        first: 1,
      },
    },
    select: ['tags.name'],
    source: postSource,
  });

  const items = await runtime.fetchByIds({
    ids: ['post-1'],
    plan,
  });

  expect(limits).toContain(2);
  expect(await plan.resolveMany(items)).toEqual([
    {
      id: 'post-1',
      tags: {
        items: [
          {
            cursor: 'tag-1',
            node: {
              id: 'tag-1',
              name: 'TypeScript',
            },
          },
        ],
        pagination: {
          hasNext: true,
          hasPrevious: false,
          nextCursor: 'tag-1',
          previousCursor: undefined,
        },
      },
    },
  ]);
});
