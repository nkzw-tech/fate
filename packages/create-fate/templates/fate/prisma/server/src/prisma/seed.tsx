#!/usr/bin/env NODE_ENV=development node --no-warnings --experimental-specifier-resolution=node --loader ts-node/esm --env-file .env
import { styleText } from 'node:util';
import randomEntry from '@nkzw/core/randomEntry.js';
import { auth } from '../lib/auth.ts';
import prisma from './prisma.ts';
import { comments, posts, users } from './seedData.ts';

console.log(styleText('bold', '› Seeding database...'));

try {
  console.log(styleText('bold', `Creating users`));

  for (const data of users) {
    const { user } = await auth.api.createUser({
      body: data,
    });

    console.log(`  Created user ${styleText('blue', user.name)}.`);
  }

  const seededUsers = await prisma.user.findMany();
  const usersByEmail = new Map(seededUsers.map((user) => [user.email, user]));

  console.log(styleText('bold', `Seeding posts and comments`));

  const createdPosts = await Promise.all(
    posts.map((post) => {
      const author = usersByEmail.get(post.authorEmail);

      if (!author) {
        throw new Error(`Missing seeded user for ${post.authorEmail}.`);
      }

      return prisma.post.create({
        data: {
          authorId: author.id,
          content: post.content,
          likes: post.likes,
          title: post.title,
        },
      });
    }),
  );

  let index = 0;
  for (const comment of comments) {
    const post = createdPosts[index % createdPosts.length];
    const author = randomEntry(seededUsers);

    await prisma.comment.create({
      data: {
        authorId: author?.id,
        content: comment,
        postId: post.id,
      },
    });

    index++;
  }

  console.log(
    styleText(
      ['green', 'bold'],
      `✓ Created ${createdPosts.length} posts and ${comments.length} comments.`,
    ),
  );

  console.log(styleText(['green', 'bold'], '✓ Done.'));
} finally {
  await prisma.$disconnect();
}
