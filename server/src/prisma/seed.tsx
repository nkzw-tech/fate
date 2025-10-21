#!/usr/bin/env NODE_ENV=development node --no-warnings --experimental-specifier-resolution=node --loader ts-node/esm --env-file .env
import { styleText } from 'node:util';
import { auth } from '../lib/auth.tsx';
import { PrismaClient } from './prisma-client/client.ts';

const prisma = new PrismaClient();

const users = new Set([
  {
    data: {
      username: 'admin',
    },
    email: 'admin@nakazawa.dev',
    name: 'Admin',
    password: 'not-a-secure-password',
    role: 'admin',
  },
  {
    data: {
      username: 'first-user',
    },
    email: 'first-user@nakazawa.dev',
    name: 'First User',
    password: 'not-a-secure-password-either',
  },
] as const);

const posts = [
  {
    authorEmail: 'admin@nakazawa.dev',
    content:
      'Exploring how composable data fetching primitives can simplify complex product architectures and speed up UI development.',
    likes: 12,
    title: 'Introducing Fate: typed data fetching experiments',
  },
  {
    authorEmail: 'first-user@nakazawa.dev',
    content:
      'Sharing some initial impressions after wiring Fate into a side-project. The ergonomics feel promising, especially around cache control.',
    likes: 9,
    title: 'Early adopter diary – week 1',
  },
  {
    authorEmail: 'admin@nakazawa.dev',
    content:
      'A quick peek at how TRPC and Prisma are working together behind the scenes. Includes a few debugging tricks that saved me hours.',
    likes: 6,
    title: 'Under the hood of our TRPC setup',
  },
  {
    authorEmail: 'first-user@nakazawa.dev',
    content:
      'Documenting the edge cases we hit when testing optimistic UI updates for reactions and threaded conversations.',
    likes: 4,
    title: 'Taming optimistic updates',
  },
  {
    authorEmail: 'admin@nakazawa.dev',
    content:
      'Sketching a roadmap for where the Fate data layer should go next and which integrations look most valuable.',
    likes: 15,
    title: 'What’s next for the Fate data layer',
  },
] as const;

const comments = [
  'Love this direction',
  'Curious how this scales',
  'Would enjoy a deep dive',
  'This sparked new ideas',
  'Following along with excitement',
  'Appreciate the transparency',
  'Already trying this out',
  'The examples are super helpful',
  'Keen to see performance numbers',
  'Thanks for sharing the learnings',
  'This could be a game-changer',
  'Looking forward to more updates',
  'How does this compare to alternatives?',
  'The community will benefit from this',
  'Great to see innovation here',
  'This aligns with my experiences',
  'Eager to test this in production',
  'The caching strategy is intriguing',
  'Can you share more code samples?',
  'This post made my day',
  'Valuable insights as always',
  'Helpful for my current project',
  'The architecture looks solid',
  'Impressed by the simplicity',
  'This clarifies a lot of doubts',
] as const;

console.log(styleText('bold', '› Seeding database...'));

try {
  console.log(styleText('bold', `Creating users`));

  for (const data of users) {
    const { user } = await auth.api.createUser({
      body: data,
    });

    console.log(`  Created user ${styleText('blue', user.name)}.`);
  }

  console.log(styleText('bold', `Seeding posts and comments`));

  const seededUsers = await prisma.user.findMany();
  const usersByEmail = new Map(seededUsers.map((user) => [user.email, user]));
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
    const author = seededUsers[index % seededUsers.length];

    await prisma.comment.create({
      data: {
        authorId: author?.id,
        content: `#${index + 1} ${comment}.`,
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
