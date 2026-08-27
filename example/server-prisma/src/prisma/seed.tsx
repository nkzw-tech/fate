#!/usr/bin/env NODE_ENV=development OXC_TSCONFIG_PATH=../../tsconfig.json node --no-warnings --experimental-specifier-resolution=node --import @oxc-node/core/register --env-file .env
import { styleText } from 'node:util';
import randomEntry from '@nkzw/core/randomEntry.js';
import { categories, comments, events, posts, tags, users } from '../../../seedData.ts';
import { auth } from '../lib/auth.tsx';
import prisma from './prisma.tsx';

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

  console.log(styleText('bold', `Creating categories and tags`));

  const createdCategories = await Promise.all(
    categories.map((category) =>
      prisma.category.create({
        data: category,
      }),
    ),
  );
  const createdTags = await Promise.all(
    tags.map((tag) =>
      prisma.tag.create({
        data: tag,
      }),
    ),
  );

  const categoriesByName = new Map(createdCategories.map((category) => [category.name, category]));
  const tagsByName = new Map(createdTags.map((tag) => [tag.name, tag]));

  console.log(styleText('bold', `Seeding posts and comments`));

  const createdPosts = await Promise.all(
    posts.map((post) => {
      const author = usersByEmail.get(post.authorEmail);

      if (!author) {
        throw new Error(`Missing seeded user for ${post.authorEmail}.`);
      }

      const category = categoriesByName.get(post.category);
      const tagConnections = post.tags
        .map((name) => tagsByName.get(name))
        .filter(Boolean)
        .map((tag) => ({ id: tag!.id }));

      return prisma.post.create({
        data: {
          authorId: author.id,
          categoryId: category?.id,
          content: post.content,
          likes: post.likes,
          tags: tagConnections.length
            ? {
                connect: tagConnections,
              }
            : undefined,
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

  console.log(styleText('bold', `Creating community events`));

  const createdEvents = await Promise.all(
    events.map((event) => {
      const host = usersByEmail.get(event.hostEmail);

      if (!host) {
        throw new Error(`Missing seeded user for ${event.hostEmail}.`);
      }

      const attendees = event.attendees
        .map((attendee) => {
          const attendeeUser = usersByEmail.get(attendee.userEmail);

          if (!attendeeUser) {
            throw new Error(`Missing seeded user for ${attendee.userEmail}.`);
          }

          return {
            notes: attendee.notes,
            status: attendee.status,
            userId: attendeeUser.id,
          };
        })
        .filter(Boolean);

      return prisma.event.create({
        data: {
          attendees: attendees.length
            ? {
                create: attendees,
              }
            : undefined,
          capacity: event.capacity,
          description: event.description,
          endAt: event.endAt,
          hostId: host.id,
          livestreamUrl: event.livestreamUrl,
          location: event.location,
          name: event.name,
          startAt: event.startAt,
          topics: [...event.topics],
          type: event.type,
        },
      });
    }),
  );

  console.log(
    styleText(
      ['green', 'bold'],
      `✓ Created ${createdEvents.length} events with ${events.reduce(
        (total, event) => total + event.attendees.length,
        0,
      )} attendee records.`,
    ),
  );

  console.log(styleText(['green', 'bold'], '✓ Done.'));
} finally {
  await prisma.$disconnect();
}
