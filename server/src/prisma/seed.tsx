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

const categories = [
  {
    description:
      'Research notes and reflections that influenced the shape of Fate.',
    name: 'Product Insights',
  },
  {
    description:
      'Implementation stories from the engineering team building Fate.',
    name: 'Engineering Logs',
  },
  {
    description: 'Community highlights, experiments, and ways to participate.',
    name: 'Community Spotlight',
  },
  {
    description:
      'Deep dives into architecture decisions and technical trade-offs.',
    name: 'Architecture Field Notes',
  },
] as const;

const tags = [
  {
    description: 'Prisma schema design tips and patterns.',
    name: 'prisma',
  },
  {
    description: 'Working with tRPC routers and advanced usage.',
    name: 'trpc',
  },
  {
    description: 'Progress updates about the Fate data layer.',
    name: 'fate',
  },
  {
    description: 'Stories from the community adopting the stack.',
    name: 'community',
  },
  {
    description: 'Designing delightful developer experiences.',
    name: 'dx',
  },
  {
    description: 'Observability, tracing, and debugging learnings.',
    name: 'observability',
  },
] as const;

const posts = [
  {
    authorEmail: 'admin@nakazawa.dev',
    category: 'Product Insights',
    content:
      'Exploring how composable data fetching primitives can simplify complex product architectures and speed up UI development.',
    likes: 18,
    tags: ['fate', 'prisma', 'dx'],
    title: 'Introducing Fate: typed data fetching experiments',
  },
  {
    authorEmail: 'first-user@nakazawa.dev',
    category: 'Community Spotlight',
    content:
      'Sharing impressions from the first Fate community build sprint, including tooling we shipped together and open threads to join next.',
    likes: 11,
    tags: ['community', 'fate'],
    title: 'Community build sprint recap',
  },
  {
    authorEmail: 'admin@nakazawa.dev',
    category: 'Architecture Field Notes',
    content:
      'A quick peek at how TRPC and Prisma are working together behind the scenes. Includes debugging tricks that saved us hours this week.',
    likes: 9,
    tags: ['trpc', 'prisma'],
    title: 'Under the hood of our TRPC setup',
  },
  {
    authorEmail: 'first-user@nakazawa.dev',
    category: 'Engineering Logs',
    content:
      'Documenting the edge cases we hit when testing optimistic UI updates for reactions and threaded conversations and how we resolved them.',
    likes: 7,
    tags: ['dx', 'fate'],
    title: 'Taming optimistic updates',
  },
  {
    authorEmail: 'admin@nakazawa.dev',
    category: 'Product Insights',
    content:
      'Sketching a roadmap for where the Fate data layer should go next and which integrations look most valuable for design partners.',
    likes: 21,
    tags: ['fate', 'community'],
    title: 'What’s next for the Fate data layer',
  },
  {
    authorEmail: 'admin@nakazawa.dev',
    category: 'Architecture Field Notes',
    content:
      'Instrumenting the stack for richer visibility: what we log, trace, and measure before every launch.',
    likes: 5,
    tags: ['observability', 'trpc'],
    title: 'Debug diaries: logging Fate in production',
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

const projects = [
  {
    focusAreas: ['Latency', 'DX polish', 'Offline-first flows'],
    metrics: {
      activeDesignPartners: 8,
      averageLatencyMs: 112,
      weeklyFeedbackScore: 4.6,
    },
    name: 'Realtime collaboration layer',
    ownerEmail: 'admin@nakazawa.dev',
    progress: 62,
    startDate: new Date('2024-02-12T00:00:00.000Z'),
    status: 'IN_PROGRESS',
    summary:
      'A conflict-friendly transport that keeps optimistic updates in sync across tabs and devices.',
    targetDate: new Date('2024-09-30T00:00:00.000Z'),
    updates: [
      {
        authorEmail: 'admin@nakazawa.dev',
        confidence: 4,
        content:
          'Shipped the offline mutation queue and validated recovery flows with design partners.',
        mood: 'Energized',
      },
      {
        authorEmail: 'first-user@nakazawa.dev',
        confidence: 5,
        content:
          'Cross-tab awareness API shipped to experiments. Observed 37% faster resolution of merge conflicts.',
        mood: 'Optimistic',
      },
    ],
  },
  {
    focusAreas: ['Schema ergonomics', 'Migration safety', 'Type generation'],
    metrics: {
      breakingChangeIncidents: 0,
      generatorRuntimeMs: 380,
    },
    name: 'Prisma schema toolkit',
    ownerEmail: 'admin@nakazawa.dev',
    progress: 48,
    startDate: new Date('2024-03-04T00:00:00.000Z'),
    status: 'IN_PROGRESS',
    summary:
      'Opinionated helpers for modeling complex content graphs without losing flexibility.',
    targetDate: new Date('2024-08-16T00:00:00.000Z'),
    updates: [
      {
        authorEmail: 'admin@nakazawa.dev',
        confidence: 3,
        content:
          'Validator library now generates `prismaSelect` paths automatically for nested relations.',
        mood: 'Curious',
      },
    ],
  },
  {
    focusAreas: ['Observability', 'Alerting', 'Developer education'],
    metrics: {
      dashboardsPublished: 5,
      meanTimeToResolutionMinutes: 24,
    },
    name: 'Experience observability toolkit',
    ownerEmail: 'first-user@nakazawa.dev',
    progress: 74,
    startDate: new Date('2024-01-22T00:00:00.000Z'),
    status: 'ON_HOLD',
    summary:
      'Playbooks, dashboards, and alert rules that make it painless to support Fate-powered apps.',
    targetDate: new Date('2024-07-05T00:00:00.000Z'),
    updates: [
      {
        authorEmail: 'first-user@nakazawa.dev',
        confidence: 2,
        content:
          'Paused launch to align on telemetry budget. Drafted new budgets with the infra team.',
        mood: 'Measured',
      },
    ],
  },
] as const;

const events = [
  {
    attendees: [
      {
        notes:
          'Wants to share learnings from migrating an analytics dashboard.',
        status: 'GOING',
        userEmail: 'first-user@nakazawa.dev',
      },
    ],
    capacity: 500,
    description:
      'A live session with the Fate core team walking through the roadmap, recent experiments, and Q&A from the community.',
    endAt: new Date('2024-07-18T18:00:00.000Z'),
    hostEmail: 'admin@nakazawa.dev',
    livestreamUrl: 'https://community.nakazawa.dev/events/fate-ama',
    location: 'Discord Stage',
    name: 'Fate roadmap AMA',
    resources: {
      agenda: 'https://community.nakazawa.dev/resources/fate-ama-agenda.pdf',
    },
    startAt: new Date('2024-07-18T17:00:00.000Z'),
    topics: ['Roadmap', 'Q&A', 'Community'],
    type: 'AMA',
  },
  {
    attendees: [
      {
        notes: 'Pairing with teams experimenting with offline-first UX.',
        status: 'INTERESTED',
        userEmail: 'admin@nakazawa.dev',
      },
      {
        notes: 'Hosting a breakout on schema modeling trade-offs.',
        status: 'GOING',
        userEmail: 'first-user@nakazawa.dev',
      },
    ],
    capacity: 120,
    description:
      'Hands-on working session to build real-time collaboration flows with Fate and share debugging techniques.',
    endAt: new Date('2024-08-02T19:00:00.000Z'),
    hostEmail: 'first-user@nakazawa.dev',
    livestreamUrl: 'https://community.nakazawa.dev/events/fate-ama',
    location: 'Hybrid – Brooklyn studio & Zoom',
    name: 'Community build sprint',
    resources: {
      checklist:
        'https://community.nakazawa.dev/resources/build-sprint-checklist',
      starterRepo: 'https://github.com/nkzw/fate-sprint-starter',
    },
    startAt: new Date('2024-08-02T15:00:00.000Z'),
    topics: ['Workshops', 'Pairing', 'Debugging'],
    type: 'WORKSHOP',
  },
  {
    attendees: [
      {
        notes: 'Evaluating integrations for a launch partner.',
        status: 'GOING',
        userEmail: 'admin@nakazawa.dev',
      },
    ],
    capacity: 60,
    description:
      'A smaller discussion group focused on integrations and extensibility opportunities for Fate.',
    endAt: new Date('2024-09-12T17:30:00.000Z'),
    hostEmail: 'admin@nakazawa.dev',
    livestreamUrl: 'https://community.nakazawa.dev/events/fate-ama',
    location: 'Virtual – Gather.town',
    name: 'Integration council meetup',
    resources: {
      discussionGuide:
        'https://community.nakazawa.dev/resources/integration-council.pdf',
    },
    startAt: new Date('2024-09-12T16:30:00.000Z'),
    topics: ['Integrations', 'Strategy'],
    type: 'MEETUP',
  },
] as const;

try {
  console.log(styleText('bold', `Resetting example content`));
  await prisma.eventAttendee.deleteMany();
  await prisma.event.deleteMany();
  await prisma.projectUpdate.deleteMany();
  await prisma.project.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.post.deleteMany();
  await prisma.category.deleteMany();
  await prisma.tag.deleteMany();

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

  const categoriesByName = new Map(
    createdCategories.map((category) => [category.name, category]),
  );
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

  console.log(styleText('bold', `Creating projects and updates`));

  const createdProjects = await Promise.all(
    projects.map((project) => {
      const owner = usersByEmail.get(project.ownerEmail);

      if (!owner) {
        throw new Error(`Missing seeded user for ${project.ownerEmail}.`);
      }

      const updates = project.updates
        .map((update) => {
          const author = usersByEmail.get(update.authorEmail);

          if (!author) {
            throw new Error(`Missing seeded user for ${update.authorEmail}.`);
          }

          return {
            authorId: author.id,
            confidence: update.confidence,
            content: update.content,
            mood: update.mood,
          };
        })
        .filter(Boolean);

      return prisma.project.create({
        data: {
          focusAreas: [...project.focusAreas],
          metrics: project.metrics,
          name: project.name,
          ownerId: owner.id,
          progress: project.progress,
          startDate: project.startDate,
          status: project.status,
          summary: project.summary,
          targetDate: project.targetDate,
          updates: updates.length
            ? {
                create: updates,
              }
            : undefined,
        },
      });
    }),
  );

  console.log(
    styleText(
      ['green', 'bold'],
      `✓ Created ${createdProjects.length} projects with ${projects.reduce(
        (total, project) => total + project.updates.length,
        0,
      )} updates.`,
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
          resources: event.resources,
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
