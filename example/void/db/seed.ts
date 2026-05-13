import { styleText } from 'node:util';
import randomEntry from '@nkzw/core/randomEntry.js';
import { defineSeed } from 'void/seed';
import { categories, comments, events, posts, tags, users } from '../../seedData.ts';
import { createEventRecord, createPostRecord } from './queries.ts';
import { category, comment, post, tag } from './schema.ts';
import { createSeedAuth } from './seed-auth.ts';

export default defineSeed<typeof import('./schema.ts')>(async ({ db }) => {
  const auth = createSeedAuth(db);
  const queryDb = db as unknown as Parameters<typeof createPostRecord>[1];
  const [existingPost] = await db.select({ id: post.id }).from(post).limit(1);

  console.log(styleText('bold', '› Seeding database...'));

  if (existingPost) {
    console.log(styleText(['green', 'bold'], '✓ Database already contains seed data.'));
    return;
  }

  console.log(styleText('bold', `Creating users`));

  for (const data of users) {
    const { user } = await auth.api.createUser({
      body: data,
    });

    console.log(`  Created user ${styleText('blue', user.name)}.`);
  }

  const seededUsers = await db.query.user.findMany();
  const usersByEmail = new Map(seededUsers.map((user) => [user.email, user]));

  console.log(styleText('bold', `Creating categories and tags`));

  const createdCategories = await Promise.all(
    categories.map(async (entry) => {
      const [created] = await db.insert(category).values(entry).returning();
      return created;
    }),
  );
  const createdTags = await Promise.all(
    tags.map(async (entry) => {
      const [created] = await db.insert(tag).values(entry).returning();
      return created;
    }),
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
      const tagIds = post.tags.flatMap((name) => {
        const id = tagsByName.get(name)?.id;
        return id ? [id] : [];
      });

      return createPostRecord(
        {
          authorId: author.id,
          categoryId: category?.id,
          content: post.content,
          likes: post.likes,
          tagIds,
          title: post.title,
        },
        queryDb,
      );
    }),
  );

  let index = 0;
  for (const content of comments) {
    const postId = createdPosts[index % createdPosts.length];
    const author = randomEntry(seededUsers);

    if (!postId) {
      throw new Error('Failed to create seeded post.');
    }

    await db.insert(comment).values({
      authorId: author?.id,
      content,
      postId,
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

      return createEventRecord(
        {
          attendees,
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
        queryDb,
      );
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
});
