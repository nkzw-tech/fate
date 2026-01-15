import { expect, test } from 'vite-plus/test';
import { prismaSelect } from '../prismaSelect.ts';

test('prismaSelect applies pagination args to relation selections', () => {
  const select = prismaSelect(['comments.id'], { comments: { first: 2 } });

  expect(select).toEqual({
    comments: {
      select: { id: true },
      take: 3,
    },
    id: true,
  });
});

test('prismaSelect maps cursor args to Prisma pagination options', () => {
  const select = prismaSelect(['comments.id'], {
    comments: { after: 'cursor-1', first: 3 },
  });

  expect(select).toEqual({
    comments: {
      cursor: { id: 'cursor-1' },
      select: { id: true },
      skip: 1,
      take: 4,
    },
    id: true,
  });
});

test('prismaSelect maps backward pagination args to Prisma options', () => {
  const select = prismaSelect(['comments.id'], {
    comments: { before: 'cursor-2', last: 2 },
  });

  expect(select).toEqual({
    comments: {
      cursor: { id: 'cursor-2' },
      select: { id: true },
      skip: 1,
      take: -3,
    },
    id: true,
  });
});
