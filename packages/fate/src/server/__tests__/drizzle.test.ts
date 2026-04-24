import { pgTable, text } from 'drizzle-orm/pg-core';
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
