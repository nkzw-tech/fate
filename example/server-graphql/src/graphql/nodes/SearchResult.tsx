import { resolveArrayConnection } from '@pothos/plugin-relay';
import prisma from '../../prisma/prisma.tsx';
import builder from '../builder.tsx';
import Post from './Post.tsx';
import User from './User.tsx';

const SearchResult = builder.unionType('SearchResult', {
  resolveType: (result) => ('title' in result ? Post : User),
  types: [Post, User],
});

builder.queryFields((t) => ({
  search: t.connection({
    args: { query: t.arg.string({ required: true }) },
    nullable: false,
    resolve: async (_, args) => {
      const value = args.query.trim();
      if (!value) {
        return resolveArrayConnection({ args }, []);
      }
      const contains = { contains: value, mode: 'insensitive' } as const;
      const [posts, users] = await Promise.all([
        prisma.post.findMany({
          orderBy: { id: 'asc' },
          take: 20,
          where: { OR: [{ title: contains }, { content: contains }] },
        }),
        prisma.user.findMany({
          orderBy: { id: 'asc' },
          take: 20,
          where: { name: contains },
        }),
      ]);
      return resolveArrayConnection({ args }, [...posts, ...users]);
    },
    type: SearchResult,
  }),
}));
