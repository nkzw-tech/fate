export const users = [
  {
    data: {
      username: 'alex',
    },
    email: 'alex@example.com',
    name: 'Alex',
    password: 'password-alex',
    role: 'admin',
  },
  {
    data: {
      username: 'ari',
    },
    email: 'ari@nakazawa.dev',
    name: 'Ari',
    password: 'password-ari',
  },
  {
    data: {
      username: 'dina',
    },
    email: 'dina@nakazawa.dev',
    name: 'Dina',
    password: 'password-dina',
  },
  {
    data: {
      username: 'hana',
    },
    email: 'hana@nakazawa.dev',
    name: 'Hana',
    password: 'password-hana',
  },
  {
    data: {
      username: 'jamal',
    },
    email: 'jamal@nakazawa.dev',
    name: 'Jamal',
    password: 'password-jamal',
  },
  {
    data: {
      username: 'kai',
    },
    email: 'kai@nakazawa.dev',
    name: 'Kai',
    password: 'password-kai',
  },
  {
    data: {
      username: 'lena',
    },
    email: 'lena@nakazawa.dev',
    name: 'Lena',
    password: 'password-lena',
  },
  {
    data: {
      username: 'mika',
    },
    email: 'mika@nakazawa.dev',
    name: 'Mika',
    password: 'password-mika',
  },
  {
    data: {
      username: 'noah',
    },
    email: 'noah@nakazawa.dev',
    name: 'Noah',
    password: 'password-noah',
  },
  {
    data: {
      username: 'sora',
    },
    email: 'sora@nakazawa.dev',
    name: 'Sora',
    password: 'password-sora',
  },
] as const;

export const categories = [
  {
    description: 'Core ideas behind views, ViewRefs, strict selection, and data masking.',
    name: 'Core Concepts',
  },
  {
    description: 'Async React, Suspense, Actions, and the react-fate hooks.',
    name: 'React Integration',
  },
  {
    description: 'Prisma, Drizzle, native HTTP, tRPC, and source adapter notes.',
    name: 'Server Integrations',
  },
  {
    description: 'Live views, live lists, SSE streams, and update events.',
    name: 'Realtime',
  },
  {
    description: 'Progress reports from the alpha releases and example applications.',
    name: 'Release Notes',
  },
  {
    description: 'Practical migration notes for teams moving away from request-centric state.',
    name: 'Migration Notes',
  },
] as const;

export const tags = [
  {
    description: 'Co-located data requirements composed into one request.',
    name: 'views',
  },
  {
    description: 'Object records keyed by typename and id.',
    name: 'normalized-cache',
  },
  {
    description: 'Strict field selection and masked component data.',
    name: 'data-masking',
  },
  {
    description: 'Suspense, Actions, use, and concurrent rendering patterns.',
    name: 'async-react',
  },
  {
    description: 'Declarative optimistic updates and automatic rollback behavior.',
    name: 'optimistic-updates',
  },
  {
    description: 'Connection-style lists with cursors and load-more flows.',
    name: 'pagination',
  },
  {
    description: 'Object and connection subscriptions over a single SSE stream.',
    name: 'live-views',
  },
  {
    description: 'The native fate protocol for clients that do not need tRPC.',
    name: 'http-transport',
  },
  {
    description: 'Prisma, Drizzle, and server-side data view adapters.',
    name: 'server-adapters',
  },
  {
    description: 'Generated client types produced by the Vite plugin.',
    name: 'vite-plugin',
  },
  {
    description: 'The Void example and full-stack routing experiment.',
    name: 'void',
  },
] as const;

export const posts = [
  {
    authorEmail: 'alex@example.com',
    category: 'Core Concepts',
    content:
      'The first note in this demo restates the core promise from the announcement: fate keeps component data requirements co-located, then composes them into one request at the screen root. Instead of deciding when every component should fetch, you describe what each component needs. The result feels close to Relay fragments, but it stays in plain TypeScript with no GraphQL schema or query language to adopt.',
    likes: 128,
    tags: ['views', 'data-masking'],
    title: 'Thinking in views instead of requests',
  },
  {
    authorEmail: 'ari@nakazawa.dev',
    category: 'Core Concepts',
    content:
      'ViewRefs are intentionally small: a typename, an id, and enough metadata for fate to resolve masked data against a view. Passing refs through the tree keeps component props light and lets each component declare the fields it reads. This post walks through how a PostCard can select title and author while a detail route adds comments, tags, and counts without creating another hand-written data shape.',
    likes: 93,
    tags: ['views', 'normalized-cache'],
    title: 'ViewRefs as the boundary between components',
  },
  {
    authorEmail: 'dina@nakazawa.dev',
    category: 'Core Concepts',
    content:
      'Strict selection is the feature that makes a demo like this stay honest. If a component did not select content, content is not part of its usable data. That protects teams from accidental coupling, makes refactors smaller, and gives code generation tools a predictable surface. The cache may know more about an object, but the component only sees the fields its view asked for.',
    likes: 87,
    tags: ['data-masking', 'views'],
    title: 'Data masking as a team contract',
  },
  {
    authorEmail: 'hana@nakazawa.dev',
    category: 'Core Concepts',
    content:
      'fate stores records by __typename and id, then points roots and lists at those records. That is why liking a post can update every view that selected likes without touching views that only selected title. This article follows one Post record through the home feed, category page, search results, and detail route to show how normalized data removes duplicate cache entries.',
    likes: 111,
    tags: ['normalized-cache', 'optimistic-updates'],
    title: 'A normalized cache without manual key math',
  },
  {
    authorEmail: 'jamal@nakazawa.dev',
    category: 'React Integration',
    content:
      'The React integration leans on Suspense instead of local loading flags. A root useRequest call can suspend while the composed selection is fetched, and errors bubble to normal error boundaries. The components underneath can stay focused on rendering masked data. The post also shows why this is useful for AI-generated code: there are fewer branches and fewer imperative states to keep in sync.',
    likes: 76,
    tags: ['async-react', 'views'],
    title: 'Suspense-first screens with useRequest',
  },
  {
    authorEmail: 'kai@nakazawa.dev',
    category: 'React Integration',
    content:
      'Actions in fate are exposed for useActionState, and mutations can carry an optimistic object alongside the input. The cache applies the optimistic update immediately, re-renders affected views, and rolls the affected records back if the server rejects the mutation. This example uses the like button because it is easy to see, but the same model works for comments and other records.',
    likes: 82,
    tags: ['async-react', 'optimistic-updates'],
    title: 'Optimistic actions that roll back cleanly',
  },
  {
    authorEmail: 'lena@nakazawa.dev',
    category: 'React Integration',
    content:
      'The comments under each post use connection-style lists so the UI can load more without inventing a pagination protocol per screen. fate tracks cursor arguments as part of the list state, merges pages into the same connection, and keeps the records normalized. The home feed starts small on purpose so the load-more button exercises this path in the example.',
    likes: 69,
    tags: ['pagination', 'normalized-cache'],
    title: 'Connection lists for comments and feeds',
  },
  {
    authorEmail: 'mika@nakazawa.dev',
    category: 'Realtime',
    content:
      'useLiveView has the same shape as useView, but it subscribes to updates for the selected object through the native live transport. The client keeps one SSE stream open, sends subscribe and unsubscribe control messages, and merges returned records into the same normalized cache used by requests and mutations. Components keep their view definitions and just opt into live data.',
    likes: 104,
    tags: ['live-views', 'normalized-cache'],
    title: 'Live views over a single SSE stream',
  },
  {
    authorEmail: 'noah@nakazawa.dev',
    category: 'Realtime',
    content:
      'Live list views extend the same idea to connections. When a comment is added, the server can emit a prepend event for Post.comments and fate updates the visible connection without deleting the underlying Comment record. By default, pagination boundaries are respected, and streams like chat can opt into visible insertion. That gives realtime behavior without turning every list into special-case UI code.',
    likes: 97,
    tags: ['live-views', 'pagination'],
    title: 'Live list views for active threads',
  },
  {
    authorEmail: 'sora@nakazawa.dev',
    category: 'Realtime',
    content:
      'Deletion events are just as important as updates. If a comment disappears, fate removes the record from the normalized cache and prunes lists or object fields that reference it. The demo comment controls exercise that behavior so the post detail route, live comment list, and comment count stay aligned after a mutation completes.',
    likes: 64,
    tags: ['live-views', 'optimistic-updates'],
    title: 'Keeping deletions consistent across lists',
  },
  {
    authorEmail: 'ari@nakazawa.dev',
    category: 'Server Integrations',
    content:
      'The launch post introduced fate with tRPC, but the repo now includes a native HTTP transport too. The generated client can point at a fate endpoint, send requests through the protocol package, and use GET and POST routes for live updates. tRPC remains a supported adapter, but the core model no longer depends on it.',
    likes: 88,
    tags: ['http-transport', 'server-adapters'],
    title: 'Native HTTP transport after the alpha launch',
  },
  {
    authorEmail: 'dina@nakazawa.dev',
    category: 'Server Integrations',
    content:
      'The server adapters now cover Prisma and Drizzle with the same data view concepts. Sources describe how to resolve records, fields, lists, counts, and computed values, while fate builds the selected shape for the client. This makes the examples useful for teams with different database layers without changing the React component model.',
    likes: 84,
    tags: ['server-adapters', 'views'],
    title: 'Prisma and Drizzle source adapters',
  },
  {
    authorEmail: 'hana@nakazawa.dev',
    category: 'Server Integrations',
    content:
      'Arguments are part of request identity, but pagination cursors are merged into the same connection when the user loads another page. This post explains why category filters, search terms, and sort options belong in the cache key while after and before control pagination state. The result follows Relay connection semantics without asking app code to manage query keys.',
    likes: 73,
    tags: ['pagination', 'server-adapters'],
    title: 'Request arguments and connection identity',
  },
  {
    authorEmail: 'jamal@nakazawa.dev',
    category: 'Release Notes',
    content:
      'The code generator is now optional for CI and custom workflows because the Vite plugin handles the common path during development. The plugin generates the typed client from the server surface, keeps imports fresh, and reduces the number of manual setup steps in a new app. It is one of the changes that makes the default template feel much closer to normal Vite development.',
    likes: 91,
    tags: ['vite-plugin', 'http-transport'],
    title: 'The Vite plugin replaces everyday codegen',
  },
  {
    authorEmail: 'kai@nakazawa.dev',
    category: 'Release Notes',
    content:
      'The cache now tracks retained requests so screens can release data when they unmount and let garbage collection clean up records that are no longer needed. For manual client.request calls, code can retain the descriptor for as long as the work needs it. The important part is that cache lifetime becomes explicit without forcing every component to think about cleanup.',
    likes: 58,
    tags: ['normalized-cache', 'async-react'],
    title: 'Garbage collection for request lifetimes',
  },
  {
    authorEmail: 'lena@nakazawa.dev',
    category: 'Release Notes',
    content:
      'Stable refs were a small change with a large ergonomic payoff. When a record has not changed, fate can keep ViewRefs stable across renders, which helps memoized components and reduces avoidable updates. Combined with strict selection, this keeps rendering tied to the fields a component actually requested instead of the shape of a whole server response.',
    likes: 67,
    tags: ['views', 'normalized-cache'],
    title: 'Stable refs and smaller rerenders',
  },
  {
    authorEmail: 'mika@nakazawa.dev',
    category: 'Migration Notes',
    content:
      'Migrating from request-centric libraries starts with a mindset shift. Instead of passing server data down as custom prop types, define small views next to the components that render them and compose those views at the route. The cache then works by object identity, so mutations and live updates update the relevant records rather than a spread of unrelated request results.',
    likes: 79,
    tags: ['views', 'normalized-cache'],
    title: 'Moving away from request-centric state',
  },
  {
    authorEmail: 'noah@nakazawa.dev',
    category: 'Migration Notes',
    content:
      'The safest adoption path is incremental. Add byId and list procedures or source adapters next to existing server routes, generate a client, and move one screen to views. The first win is usually removing loading branches and manual cache patches from a feed or detail page. From there, optimistic actions and live views can be introduced without rewriting the whole app.',
    likes: 62,
    tags: ['server-adapters', 'async-react'],
    title: 'An incremental adoption checklist',
  },
  {
    authorEmail: 'sora@nakazawa.dev',
    category: 'Release Notes',
    content:
      'The Void example uses the same fate ideas in a full-stack app with file-system routing, shared data, auth, mutations, live comments, categories, tags, and events. It exists to prove the core protocol and React APIs are not tied to one server framework. The seed data includes this post so search and category views can show the newest example alongside the Prisma and Drizzle servers.',
    likes: 86,
    tags: ['void', 'http-transport'],
    title: 'What the Void example proves',
  },
] as const;

export const comments = [
  'The view-first framing is the clearest way I have seen to explain why request hooks create so much incidental state.',
  'Passing ViewRefs through components made the example easier to read than a stack of custom DTO types.',
  'Strict selection caught a missing field in my test component immediately, which is exactly the kind of failure I want.',
  'The normalized cache explanation finally connected likes, comments, categories, and search results for our team.',
  'Suspense at the request root keeps the route code small, and the error boundary story feels like normal React.',
  'The useActionState integration is practical because the form code still looks like React instead of a custom mutation framework.',
  'Connection lists are a good fit for this demo because the small home feed forces loadNext to be exercised.',
  'The single SSE connection model is reassuring; we were worried live views would create one stream per card.',
  'Live list events matching Post.comments is the detail that made the comment thread behavior click for me.',
  'Deletion pruning is the kind of edge case that usually gets missed in hand-written cache updates.',
  'Native HTTP transport makes adoption easier for teams that like the fate model but are not on tRPC.',
  'Having Prisma and Drizzle examples side by side makes the server adapter story much more concrete.',
  'The distinction between filters and pagination cursors is useful for avoiding accidental cache fragmentation.',
  'The Vite plugin removing the regular codegen step will help a lot in demos and fresh projects.',
  'Explicit retain and release behavior answers the question of how long normalized data should live.',
  'Stable refs should make a visible difference in large feeds with memoized cards.',
  'The migration checklist is realistic because it starts with one screen instead of a full rewrite.',
  'I appreciate that the examples still work with existing server routes while adding the fate procedures.',
  'The Void example is a nice proof that the transport and React APIs are portable.',
  'Search results and category pages sharing Post records is a good way to show the cache doing real work.',
  'Optimistic likes are simple, but they make the rollback behavior easy to test in front of someone.',
  'Live comments plus optimistic comments give the demo a lot more texture than a static blog feed.',
  'The data masking examples should be required reading before anyone adds fields to a shared component.',
  'I like that the posts use product language instead of pretending this is a generic social network.',
  'The server adapter notes helped me understand why fields and lists can share one selection pipeline.',
  'The HTTP transport post answers the biggest question I had after reading the original announcement.',
  'Connection identity following Relay semantics is a strong choice for teams that already know that model.',
  'Garbage collection is easy to ignore until a long-lived app starts leaking records during navigation.',
  'The stable ref change sounds small, but it explains a lot of the rerender fixes in the history.',
  'The new seed data makes the event cards useful because the topics map to real fate features.',
  'I used the strict selection post to explain why overfetching is not just a network problem.',
  'The live deletion path matters for moderation workflows where comments disappear from multiple views.',
  'The native protocol should make it easier to build examples outside of Hono and tRPC.',
  'This makes me want a small debugging panel that shows which views selected a field.',
  'The Vite plugin note clarifies why the generated client is still present without making codegen feel mandatory.',
  'The migration sequence matches how we would try this inside an existing dashboard.',
  'The comments list is long enough now to exercise load-more behavior without creating fake lorem ipsum.',
  'The category descriptions make the sidebar useful for navigating the demo.',
  'Seeing optimistic actions and live updates use the same normalized cache is the key idea.',
  'The Void example deserves a walkthrough because it proves the framework integration boundary is small.',
  'I would link the stable refs note from the performance section of the docs.',
  'The source adapter post helped our backend team map data views to our existing models.',
  'The React integration posts make it clear that fate is not trying to replace React state.',
  'The event seed data now looks like something a real project would use for launch planning.',
  'The cache lifetime post is a good reminder to retain manual requests outside React.',
  'The search route feels more convincing when it can find live views, adapters, and migration content.',
  'The examples now cover the features added after the announcement instead of stopping at the initial alpha.',
  'I like that the same records can appear in the feed, categories, search, and detail pages without duplicate cache data.',
] as const;

export const events = [
  {
    attendees: [
      {
        notes: 'Hosting the walkthrough and collecting alpha feedback.',
        status: 'GOING',
        userEmail: 'alex@example.com',
      },
      {
        notes: 'Preparing questions about native HTTP deployments.',
        status: 'GOING',
        userEmail: 'ari@nakazawa.dev',
      },
      {
        notes: 'Wants to compare the tRPC and HTTP client setup.',
        status: 'INTERESTED',
        userEmail: 'dina@nakazawa.dev',
      },
    ],
    capacity: 300,
    description:
      'A guided tour of the current alpha covering views, normalized caching, native HTTP, and the updated example apps.',
    endAt: new Date('2026-05-20T18:30:00.000Z'),
    hostEmail: 'alex@example.com',
    livestreamUrl: 'https://fate.technology',
    location: 'Online',
    name: 'fate alpha progress call',
    startAt: new Date('2026-05-20T17:30:00.000Z'),
    topics: ['Views', 'Native HTTP', 'Examples'],
    type: 'COMMUNITY_CALL',
  },
  {
    attendees: [
      {
        notes: 'Bringing a feed screen to convert during the session.',
        status: 'GOING',
        userEmail: 'hana@nakazawa.dev',
      },
      {
        notes: 'Interested in data masking and missing-field failures.',
        status: 'GOING',
        userEmail: 'jamal@nakazawa.dev',
      },
      {
        notes: 'Comparing ViewRefs with their current DTO props.',
        status: 'INTERESTED',
        userEmail: 'kai@nakazawa.dev',
      },
    ],
    capacity: 120,
    description:
      'Hands-on workshop for replacing request hooks with co-located views, root requests, and Suspense boundaries.',
    endAt: new Date('2026-05-28T20:00:00.000Z'),
    hostEmail: 'ari@nakazawa.dev',
    livestreamUrl: 'https://fate.technology',
    location: 'Nakazawa Tech Studio',
    name: 'From request hooks to views',
    startAt: new Date('2026-05-28T16:00:00.000Z'),
    topics: ['Migration', 'Suspense', 'Data masking'],
    type: 'WORKSHOP',
  },
  {
    attendees: [
      {
        notes: 'Showing comment prepend and delete events.',
        status: 'GOING',
        userEmail: 'mika@nakazawa.dev',
      },
      {
        notes: 'Testing reconnection behavior for event streams.',
        status: 'INTERESTED',
        userEmail: 'noah@nakazawa.dev',
      },
      {
        notes: 'Taking notes for the live views guide.',
        status: 'GOING',
        userEmail: 'sora@nakazawa.dev',
      },
    ],
    capacity: 180,
    description:
      'Live demo of object updates, connection events, visible inserts, deletion pruning, and one SSE stream per client.',
    endAt: new Date('2026-06-04T19:00:00.000Z'),
    hostEmail: 'mika@nakazawa.dev',
    livestreamUrl: 'https://fate.technology',
    location: 'Online',
    name: 'Live views lab',
    startAt: new Date('2026-06-04T17:30:00.000Z'),
    topics: ['Live views', 'SSE', 'Pagination'],
    type: 'MEETUP',
  },
  {
    attendees: [
      {
        notes: 'Bringing a Prisma schema with computed counts.',
        status: 'GOING',
        userEmail: 'dina@nakazawa.dev',
      },
      {
        notes: 'Mapping Drizzle relations to source adapters.',
        status: 'GOING',
        userEmail: 'lena@nakazawa.dev',
      },
      {
        notes: 'Checking how native HTTP fits their deployment.',
        status: 'INTERESTED',
        userEmail: 'ari@nakazawa.dev',
      },
    ],
    capacity: 90,
    description:
      'Server-focused session on data views, source adapters, Prisma, Drizzle, and the native fate HTTP handler.',
    endAt: new Date('2026-06-12T18:30:00.000Z'),
    hostEmail: 'dina@nakazawa.dev',
    livestreamUrl: 'https://fate.technology',
    location: 'Online',
    name: 'Server adapter office hours',
    startAt: new Date('2026-06-12T17:00:00.000Z'),
    topics: ['Prisma', 'Drizzle', 'HTTP transport'],
    type: 'AMA',
  },
  {
    attendees: [
      {
        notes: 'Demoing the Void example home route.',
        status: 'GOING',
        userEmail: 'sora@nakazawa.dev',
      },
      {
        notes: 'Testing the generated client in a full-stack app.',
        status: 'GOING',
        userEmail: 'jamal@nakazawa.dev',
      },
      {
        notes: 'Watching for SSR and routing integration notes.',
        status: 'INTERESTED',
        userEmail: 'hana@nakazawa.dev',
      },
    ],
    capacity: 150,
    description:
      'Launch review for the Void example, including routing, auth, seed data, live comments, and fate client generation.',
    endAt: new Date('2026-06-24T18:00:00.000Z'),
    hostEmail: 'sora@nakazawa.dev',
    livestreamUrl: 'https://fate.technology',
    location: 'Online',
    name: 'Void example launch review',
    startAt: new Date('2026-06-24T17:00:00.000Z'),
    topics: ['Void', 'Vite plugin', 'Examples'],
    type: 'LAUNCH',
  },
] as const;
