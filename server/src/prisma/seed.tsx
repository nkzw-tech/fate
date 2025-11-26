#!/usr/bin/env NODE_ENV=development node --no-warnings --experimental-specifier-resolution=node --loader ts-node/esm --env-file .env
import { styleText } from 'node:util';
import randomEntry from '@nkzw/core/randomEntry.js';
import { auth } from '../lib/auth.tsx';
import prisma from './prisma.tsx';

const users = new Set([
  {
    data: {
      username: 'christoph',
    },
    email: 'christoph@nakazawa.dev',
    name: 'Christoph',
    password: 'launch-day-password',
    role: 'admin',
  },
  {
    data: {
      username: 'maya-lopez',
    },
    email: 'maya@nakazawa.dev',
    name: 'Maya Lopez',
    password: 'password-maya',
  },
  {
    data: {
      username: 'sam-hanlon',
    },
    email: 'sam@nakazawa.dev',
    name: 'Sam Hanlon',
    password: 'password-sam',
  },
  {
    data: {
      username: 'mateo-silva',
    },
    email: 'mateo@nakazawa.dev',
    name: 'Mateo Silva',
    password: 'password-mateo',
  },
  {
    data: {
      username: 'max-parker',
    },
    email: 'max@nakazawa.dev',
    name: 'Max Parker',
    password: 'password-max',
  },
  {
    data: {
      username: 'riku-yamamoto',
    },
    email: 'riku@nakazawa.dev',
    name: 'Riku Yamamoto',
    password: 'password-riku',
  },
  {
    data: {
      username: 'amina-farah',
    },
    email: 'amina@nakazawa.dev',
    name: 'Amina Farah',
    password: 'password-amina',
  },
  {
    data: {
      username: 'jonas-becker',
    },
    email: 'jonas@nakazawa.dev',
    name: 'Jonas Becker',
    password: 'password-jonas',
  },
  {
    data: {
      username: 'evelyn-chen',
    },
    email: 'evelyn@nakazawa.dev',
    name: 'Evelyn Chen',
    password: 'password-evelyn',
  },
  {
    data: {
      username: 'diego-morales',
    },
    email: 'diego@nakazawa.dev',
    name: 'Diego Morales',
    password: 'password-diego',
  },
  {
    data: {
      username: 'harriet-osei',
    },
    email: 'harriet@nakazawa.dev',
    name: 'Harriet Osei',
    password: 'password-harriet',
  },
] as const);

const categories = [
  {
    description: 'Day-to-day notes from shipping Fate across web and server.',
    name: 'Build Diaries',
  },
  {
    description:
      'Deep dives into the normalized store, coverage masks, and cache math.',
    name: 'Cache Mechanics',
  },
  {
    description:
      'Guides for the React hooks, request planner, and transport adapters.',
    name: 'API Surface',
  },
  {
    description:
      'Stories and feedback from early design partners running Fate in anger.',
    name: 'Community Dispatches',
  },
] as const;

const tags = [
  {
    description: 'Coverage masks, merge strategies, and cache ergonomics.',
    name: 'normalized-cache',
  },
  {
    description: 'Tips for composing Fate views and request plans.',
    name: 'view-dsl',
  },
  {
    description: 'React Suspense patterns, server preloading, and streaming.',
    name: 'suspense',
  },
  {
    description: 'Optimistic responses, rollback flows, and mutation queues.',
    name: 'optimistic',
  },
  {
    description: 'Cursor math, pagination helpers, and list management.',
    name: 'pagination',
  },
  {
    description: 'Compiler artifacts, generated types, and DX automation.',
    name: 'codegen',
  },
  {
    description: 'Dispatches from design partners integrating Fate.',
    name: 'community',
  },
] as const;

const posts = [
  {
    authorEmail: 'christoph@nakazawa.dev',
    category: 'Cache Mechanics',
    content:
      'A quick walk through the new store.merge snapshots and why coverage masks keep subviews honest. Includes an example of diffPaths when React refetches nested views.',
    likes: 48,
    tags: ['normalized-cache', 'suspense'],
    title: 'Tracing normalized cache merges',
  },
  {
    authorEmail: 'sam@nakazawa.dev',
    category: 'Build Diaries',
    content:
      'Documenting how we compose comment fragments with view() and share selection payloads across modules. The post includes screenshots from the generated request artifacts.',
    likes: 31,
    tags: ['view-dsl', 'codegen'],
    title: 'View DSL for nested comment threads',
  },
  {
    authorEmail: 'mateo@nakazawa.dev',
    category: 'API Surface',
    content:
      'Notes from wiring useRequest into the dashboard and why we rely on throw-based suspense for hydration. I also cover the unexpected benefits of keeping httpBatchLink enabled.',
    likes: 36,
    tags: ['suspense', 'normalized-cache'],
    title: 'Suspense-first request API in practice',
  },
  {
    authorEmail: 'max@nakazawa.dev',
    category: 'Build Diaries',
    content:
      'A field report on wiring optimisticResponse helpers and the rollback snapshots in store.removeReferencesTo. Includes failure cases we hit while testing deletions.',
    likes: 29,
    tags: ['optimistic', 'normalized-cache'],
    title: 'Optimistic mutations without flinching',
  },
  {
    authorEmail: 'riku@nakazawa.dev',
    category: 'API Surface',
    content:
      'We tried preloading request plans inside the RSC boundary to slash TTFB. Here are the serialization tricks and the hydrate() checklist that actually worked.',
    likes: 22,
    tags: ['suspense', 'view-dsl'],
    title: 'Server preloading experiments',
  },
  {
    authorEmail: 'amina@nakazawa.dev',
    category: 'Community Dispatches',
    content:
      'Highlights from our office hours with teams leaving query-key land. The transcript covers how Fate handles invalidation math and what still lives on the roadmap.',
    likes: 41,
    tags: ['community', 'normalized-cache'],
    title: 'Community Q&A: migrating from TanStack Query',
  },
  {
    authorEmail: 'jonas@nakazawa.dev',
    category: 'Cache Mechanics',
    content:
      'Sketching the connection helper we are prototyping atop the list APIs. Expect cursor math, temp ids, and a candid look at what still feels clumsy.',
    likes: 18,
    tags: ['pagination', 'view-dsl'],
    title: 'Pagination helper sketch',
  },
  {
    authorEmail: 'evelyn@nakazawa.dev',
    category: 'Build Diaries',
    content:
      'Celebrating the first end-to-end run of the codegen pipeline that emits view tags and route plans. Also sharing how we annotate mutations to keep optimistic types strict.',
    likes: 25,
    tags: ['codegen', 'optimistic'],
    title: 'Codegen milestones for launch',
  },
  {
    authorEmail: 'maya@nakazawa.dev',
    category: 'Community Dispatches',
    content:
      'A short checklist we send to new teams trying Fate for the first time. It links to example views, transport configs, and the metrics we watch during their first week.',
    likes: 33,
    tags: ['community', 'view-dsl'],
    title: 'Design partner onboarding checklist',
  },
  {
    authorEmail: 'diego@nakazawa.dev',
    category: 'API Surface',
    content:
      'How we instrumented the fallback transport to keep Suspense boundaries happy during error bursts. Includes notes on retry semantics from the transport.ts implementation.',
    likes: 19,
    tags: ['suspense', 'codegen'],
    title: 'Transport adapters and fallbacks',
  },
  {
    authorEmail: 'harriet@nakazawa.dev',
    category: 'Community Dispatches',
    content:
      'Summarizing the dashboards we rely on during launch events and how optimistic mutations feed those counters. Closing with a template the community can fork.',
    likes: 17,
    tags: ['community', 'optimistic'],
    title: 'Event telemetry for live launches',
  },
] as const;

const comments = [
  'The coverage masks explanation finally clicked for me',
  'Please share the diffPaths tracing script',
  'Loving the minimal suspense API example',
  'The optimistic rollback notes saved our build',
  'Appreciate the hydrate() checklist',
  'Our team related to the query-key migration pain',
  'Cursor math section is exactly what I needed',
  'Thanks for outlining the codegen milestones',
  'Excited to try the onboarding checklist with my squad',
  'Transport retry notes answered a long standing question',
  'Telemetry template will ship in our control room',
  'Coverage snapshots sound battle tested now',
  'The generated artifacts screenshot was clutch',
  'Suspense batching notes pair nicely with React 19 Actions',
  'Rollback edge cases were wild to read',
  'Streaming preloads are on my TODO after this',
  'Love seeing community quotes in the recap',
  'Connection helper sketch reminded me of Relay days',
  'Cannot wait for proper pagination helpers to land',
  'Generated types for mutations look sharp',
  'Sharing this checklist with our design partners',
  'Fallback transport design is a gem',
  'Telemetry dashboards screenshot gave me ideas',
  'DiffPaths deep dive deserves its own talk',
  'Hoisted views reducing chatter is huge',
  'Optimistic cues lining up with suspense is elegant',
  'Pagination temp ids strategy makes sense',
  'Appreciate the candid note about roadmap gaps',
  'Will your codegen emit zod validators next?',
  'Preloading experiments inspire confidence for SSR',
] as const;

console.log(styleText('bold', '› Seeding database...'));

const projects = [
  {
    focusAreas: ['Suspense hygiene', 'Server streaming', 'DX testing'],
    metrics: {
      hydrationPassRate: 0.94,
      syntheticRequestsPerMinute: 420,
    },
    name: 'Suspense hydration harness',
    ownerEmail: 'christoph@nakazawa.dev',
    progress: 68,
    startDate: new Date('2024-02-19T00:00:00.000Z'),
    status: 'IN_PROGRESS',
    summary:
      'Test rig for verifying request preloads and throw-based suspense boundaries before shipping new views.',
    targetDate: new Date('2024-10-15T00:00:00.000Z'),
    updates: [
      {
        authorEmail: 'christoph@nakazawa.dev',
        confidence: 4,
        content:
          'Extended the harness to simulate streaming partial payloads and caught a regression in store.merge coverage.',
        mood: 'Confident',
      },
      {
        authorEmail: 'mateo@nakazawa.dev',
        confidence: 3,
        content:
          'Hooked the harness into the React 19 canary build and confirmed the new scheduler still flushes our batched requests.',
        mood: 'Curious',
      },
    ],
  },
  {
    focusAreas: ['Type safety', 'Cache introspection', 'Tooling'],
    metrics: {
      generatedArtifacts: 18,
      maskDiffBugs: 1,
    },
    name: 'Normalized cache validator',
    ownerEmail: 'sam@nakazawa.dev',
    progress: 54,
    startDate: new Date('2024-03-11T00:00:00.000Z'),
    status: 'IN_PROGRESS',
    summary:
      'CLI to audit coverage masks, diffPaths output, and list snapshots across releases.',
    targetDate: new Date('2024-09-06T00:00:00.000Z'),
    updates: [
      {
        authorEmail: 'sam@nakazawa.dev',
        confidence: 4,
        content:
          'Prototype reads store.snapshots and highlights missing fields before runtime fetches fire.',
        mood: 'Energized',
      },
      {
        authorEmail: 'jonas@nakazawa.dev',
        confidence: 3,
        content:
          'Working on pagination fixtures so the validator understands cursor mutations.',
        mood: 'Heads-down',
      },
    ],
  },
  {
    focusAreas: ['Community onboarding', 'Documentation', 'Instrumentation'],
    metrics: {
      averageNps: 4.8,
      partnersActive: 12,
    },
    name: 'Community adoption pilot',
    ownerEmail: 'amina@nakazawa.dev',
    progress: 73,
    startDate: new Date('2024-01-29T00:00:00.000Z'),
    status: 'IN_PROGRESS',
    summary:
      'Support program guiding design partners through view DSL adoption and telemetry setup.',
    targetDate: new Date('2024-07-26T00:00:00.000Z'),
    updates: [
      {
        authorEmail: 'amina@nakazawa.dev',
        confidence: 5,
        content:
          'Hosted the first migration clinic and documented common TanStack Query exits.',
        mood: 'Upbeat',
      },
      {
        authorEmail: 'maya@nakazawa.dev',
        confidence: 4,
        content:
          'Published the onboarding checklist plus the new metrics dashboard template.',
        mood: 'Proud',
      },
    ],
  },
  {
    focusAreas: ['Mutation flows', 'Error recovery', 'Action queues'],
    metrics: {
      queueLatencyMs: 38,
      rollbackBugsOpen: 2,
    },
    name: 'Optimistic mutation queue',
    ownerEmail: 'max@nakazawa.dev',
    progress: 46,
    startDate: new Date('2024-04-08T00:00:00.000Z'),
    status: 'IN_PROGRESS',
    summary:
      'Queue manager exploring incremental rollbacks versus last-wins semantics for Actions.',
    targetDate: new Date('2024-11-01T00:00:00.000Z'),
    updates: [
      {
        authorEmail: 'max@nakazawa.dev',
        confidence: 2,
        content:
          'Spiked an approach storing snapshots per mutation to compare last-wins and incremental merges.',
        mood: 'Investigating',
      },
      {
        authorEmail: 'christoph@nakazawa.dev',
        confidence: 3,
        content:
          'Reviewing queue instrumentation results to ensure store.removeReferencesTo stays deterministic.',
        mood: 'Focused',
      },
    ],
  },
] as const;

const events = [
  {
    attendees: [
      {
        notes: "Wants to demo their team's Suspense debugging checklist.",
        status: 'GOING',
        userEmail: 'maya@nakazawa.dev',
      },
      {
        notes: 'Collecting feedback on coverage tooling.',
        status: 'GOING',
        userEmail: 'sam@nakazawa.dev',
      },
    ],
    capacity: 400,
    description:
      'Launch day AMA with Christoph walking through request planner internals and normalized cache strategies.',
    endAt: new Date('2024-07-25T18:30:00.000Z'),
    hostEmail: 'christoph@nakazawa.dev',
    livestreamUrl: 'https://fate.nakazawa.dev/launch-ama',
    location: 'Discord Stage',
    name: 'Fate launch AMA',
    resources: {
      outline: 'https://fate.nakazawa.dev/assets/launch-ama-outline.pdf',
    },
    startAt: new Date('2024-07-25T17:30:00.000Z'),
    topics: ['Launch', 'Roadmap', 'Community'],
    type: 'AMA',
  },
  {
    attendees: [
      {
        notes: 'Sharing pagination prototypes with the group.',
        status: 'GOING',
        userEmail: 'jonas@nakazawa.dev',
      },
      {
        notes: 'Interested in Suspense hydration metrics.',
        status: 'INTERESTED',
        userEmail: 'evelyn@nakazawa.dev',
      },
    ],
    capacity: 150,
    description:
      'Hands-on workshop building view() fragments, pagination helpers, and optimistic flows in a demo app.',
    endAt: new Date('2024-08-09T20:00:00.000Z'),
    hostEmail: 'sam@nakazawa.dev',
    livestreamUrl: 'https://fate.nakazawa.dev/view-dsl-workshop',
    location: 'Hybrid — Brooklyn studio & Zoom',
    name: 'View DSL workshop',
    resources: {
      checklist: 'https://fate.nakazawa.dev/assets/view-dsl-checklist.md',
      repo: 'https://github.com/nkzw/fate-workshop',
    },
    startAt: new Date('2024-08-09T16:00:00.000Z'),
    topics: ['Views', 'Pagination', 'Codegen'],
    type: 'WORKSHOP',
  },
  {
    attendees: [
      {
        notes: 'Moderating the data panel for partners.',
        status: 'GOING',
        userEmail: 'amina@nakazawa.dev',
      },
      {
        notes: 'Collecting telemetry requirements from adopters.',
        status: 'GOING',
        userEmail: 'harriet@nakazawa.dev',
      },
      {
        notes: 'Curious about transport fallbacks for edge environments.',
        status: 'INTERESTED',
        userEmail: 'diego@nakazawa.dev',
      },
    ],
    capacity: 250,
    description:
      'Monthly community call covering migration stories, telemetry dashboards, and transport hardening tips.',
    endAt: new Date('2024-09-04T18:30:00.000Z'),
    hostEmail: 'harriet@nakazawa.dev',
    livestreamUrl: 'https://fate.nakazawa.dev/community-call',
    location: 'Virtual — Gather.town',
    name: 'Community adoption call',
    resources: {
      notes: 'https://fate.nakazawa.dev/assets/community-call-notes',
    },
    startAt: new Date('2024-09-04T17:30:00.000Z'),
    topics: ['Community', 'Telemetry', 'Transport'],
    type: 'COMMUNITY_CALL',
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
    const author = randomEntry(seededUsers);

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
