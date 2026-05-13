#!/usr/bin/env NODE_ENV=development node --no-warnings --experimental-specifier-resolution=node --loader ts-node/esm --env-file .env
import { styleText } from 'node:util';
import randomEntry from '@nkzw/core/randomEntry.js';
import { auth } from '../lib/auth.ts';
import db, { closeDatabase } from './db.ts';
import { comment, post } from './schema.ts';
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

  const seededUsers = await db.query.user.findMany();
  const usersByEmail = new Map(seededUsers.map((user) => [user.email, user]));

  console.log(styleText('bold', `Seeding posts and comments`));

  const createdPosts = await Promise.all(
    posts.map(async (postData) => {
      const author = usersByEmail.get(postData.authorEmail);

      if (!author) {
        throw new Error(`Missing seeded user for ${postData.authorEmail}.`);
      }

      const [created] = await db
        .insert(post)
        .values({
          authorId: author.id,
          content: postData.content,
          likes: postData.likes,
          title: postData.title,
        })
        .returning();

      if (!created) {
        throw new Error(`Failed to create post '${postData.title}'.`);
      }

      return created;
    }),
  );

  let index = 0;
  for (const content of comments) {
    const post = createdPosts[index % createdPosts.length];
    const author = randomEntry(seededUsers);

    await db.insert(comment).values({
      authorId: author?.id,
      content,
      postId: post.id,
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
  await closeDatabase();
}
