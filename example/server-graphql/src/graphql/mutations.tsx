import { GraphQLError } from 'graphql';
import { auth } from '../lib/auth.tsx';
import prisma from '../prisma/prisma.tsx';
import builder, { JSONScalar } from './builder.tsx';
import { live } from './fate.ts';

const PostAddInput = builder.inputType('PostAddInput', {
  fields: (t) => ({
    args: t.field({ type: JSONScalar }),
    content: t.string({ required: true }),
    title: t.string({ required: true }),
  }),
});

const PostLikeInput = builder.inputType('PostLikeInput', {
  fields: (t) => ({
    args: t.field({ type: JSONScalar }),
    error: t.string(),
    id: t.string({ required: true }),
    slow: t.boolean(),
  }),
});

const PostUnlikeInput = builder.inputType('PostUnlikeInput', {
  fields: (t) => ({
    args: t.field({ type: JSONScalar }),
    id: t.string({ required: true }),
  }),
});

const CommentAddInput = builder.inputType('CommentAddInput', {
  fields: (t) => ({
    args: t.field({ type: JSONScalar }),
    content: t.string({ required: true }),
    postId: t.string({ required: true }),
  }),
});

const CommentDeleteInput = builder.inputType('CommentDeleteInput', {
  fields: (t) => ({
    args: t.field({ type: JSONScalar }),
    id: t.string({ required: true }),
  }),
});

const UserUpdateInput = builder.inputType('UserUpdateInput', {
  fields: (t) => ({
    args: t.field({ type: JSONScalar }),
    name: t.string({ required: true }),
  }),
});

builder.mutationField('postAdd', (t) =>
  t.prismaField({
    args: {
      input: t.arg({ required: true, type: PostAddInput }),
    },
    resolve: async (query, _root, { input }, { sessionUser }) => {
      if (!sessionUser) {
        throw new Error('You must be logged in to add a post.');
      }

      if (!input.title.length || !input.content.length) {
        throw new GraphQLError('Title and content are required.', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      const post = await prisma.post.create({
        ...query,
        data: {
          authorId: sessionUser.id,
          content: input.content,
          title: input.title,
        },
      });

      live.connection('posts').prependNode('Post', post.id);
      return post;
    },
    type: 'Post',
  }),
);

builder.mutationField('postLike', (t) =>
  t.prismaField({
    args: {
      input: t.arg({ required: true, type: PostLikeInput }),
    },
    resolve: async (query, _root, { input }) => {
      if (input.slow) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      if (input.error === 'boundary') {
        throw new Error('Simulated error.');
      }

      if (input.error === 'callSite') {
        await new Promise((resolve) => setTimeout(resolve, 200));
        throw new Error('Gotta pay up.');
      }

      const existing = await prisma.post.findUnique({
        where: { id: input.id },
      });

      if (!existing) {
        throw new Error('Post not found.');
      }

      const post = await prisma.post.update({
        ...query,
        data: {
          likes: {
            increment: 1,
          },
        },
        where: { id: input.id },
      });

      live.update('Post', input.id, { changed: ['likes'] });
      return post;
    },
    type: 'Post',
  }),
);

builder.mutationField('postUnlike', (t) =>
  t.prismaField({
    args: {
      input: t.arg({ required: true, type: PostUnlikeInput }),
    },
    resolve: async (query, _root, { input }) => {
      const post = await prisma.$transaction(async (tx) => {
        const existing = await tx.post.findUnique({
          select: {
            likes: true,
          },
          where: {
            id: input.id,
          },
        });

        if (!existing) {
          throw new Error('Post not found.');
        }

        if (existing.likes <= 0) {
          return tx.post.findUniqueOrThrow({
            ...query,
            where: { id: input.id },
          });
        }

        return tx.post.update({
          ...query,
          data: {
            likes: {
              decrement: 1,
            },
          },
          where: { id: input.id },
        });
      });

      live.update('Post', input.id, { changed: ['likes'] });
      return post;
    },
    type: 'Post',
  }),
);

builder.mutationField('commentAdd', (t) =>
  t.prismaField({
    args: {
      input: t.arg({ required: true, type: CommentAddInput }),
    },
    resolve: async (query, _root, { input }, { sessionUser }) => {
      if (!sessionUser) {
        throw new Error('You must be logged in to add a comment.');
      }

      const post = await prisma.post.findUnique({
        where: {
          id: input.postId,
        },
      });

      if (!post) {
        throw new Error('Post not found.');
      }

      const comment = await prisma.comment.create({
        ...query,
        data: {
          authorId: sessionUser.id,
          content: input.content,
          postId: input.postId,
        },
      });

      live.connection('Post.comments', { id: input.postId }).appendNode('Comment', comment.id);
      live.update('Post', input.postId, { changed: ['commentCount', 'comments'] });

      return comment;
    },
    type: 'Comment',
  }),
);

builder.mutationField('commentDelete', (t) =>
  t.prismaField({
    args: {
      input: t.arg({ required: true, type: CommentDeleteInput }),
    },
    resolve: async (query, _root, { input }) => {
      const comment = await prisma.comment.findUnique({
        select: { authorId: true, postId: true },
        where: { id: input.id },
      });

      if (!comment) {
        throw new Error('Comment not found.');
      }

      const result = await prisma.comment.delete({
        ...query,
        where: { id: input.id },
      });

      live.connection('Post.comments', { id: comment.postId }).deleteEdge('Comment', input.id);
      live.update('Post', comment.postId, { changed: ['commentCount', 'comments'] });

      return result;
    },
    type: 'Comment',
  }),
);

builder.mutationField('userUpdate', (t) =>
  t.prismaField({
    args: {
      input: t.arg({ required: true, type: UserUpdateInput }),
    },
    resolve: async (query, _root, { input }, { headers, sessionUser }) => {
      if (!sessionUser) {
        throw new Error('You must be logged in to update your name.');
      }

      const name = input.name.trim();

      if (name.length < 2 || name.length > 50) {
        throw new Error('Name must be between 2 and 50 characters.');
      }

      await auth.api.updateUser({
        body: { name },
        headers,
      });

      const user = await prisma.user.findUniqueOrThrow({
        ...query,
        where: { id: sessionUser.id },
      });

      live.update('User', sessionUser.id, { changed: ['name'] });
      return user;
    },
    type: 'User',
  }),
);
