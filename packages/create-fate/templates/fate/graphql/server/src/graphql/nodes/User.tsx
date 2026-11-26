import prisma from '../../prisma/prisma.tsx';
import builder from '../builder.tsx';

const User = builder.prismaNode('User', {
  fields: (t) => ({
    email: t.exposeString('email', {
      authScopes: (user) => ({ self: user.id }),
      directives: { auth: { self: true } },
    }),
    name: t.exposeString('name', { nullable: false }),
    username: t.exposeString('username'),
  }),
  id: { field: 'id' },
});

builder.queryFields((t) => ({
  viewer: t.prismaField({
    resolve: (query, _root, _args, { sessionUser }) =>
      sessionUser
        ? prisma.user.findUniqueOrThrow({
            ...query,
            where: { id: sessionUser.id },
          })
        : void query.include,
    type: 'User',
  }),
}));

export default User;
