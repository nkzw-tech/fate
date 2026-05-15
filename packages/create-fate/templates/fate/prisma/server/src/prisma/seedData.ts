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
] as const;

export const posts = [
  {
    authorEmail: 'alex@example.com',
    content:
      'fate keeps component data requirements co-located, then composes them into one request at the screen root. Instead of deciding when every component should fetch, you describe what each component needs. The result feels close to Relay fragments, but it stays in plain TypeScript with no GraphQL schema or query language to adopt.',
    likes: 128,
    title: 'Thinking in views instead of requests',
  },
  {
    authorEmail: 'ari@nakazawa.dev',
    content:
      'ViewRefs are intentionally small: a typename, an id, and enough metadata for fate to resolve masked data against a view. Passing refs through the tree keeps component props light and lets each component declare the fields it reads. A PostCard can select title and author while a detail route adds comments and counts without creating another hand-written data shape.',
    likes: 93,
    title: 'ViewRefs as the boundary between components',
  },
  {
    authorEmail: 'dina@nakazawa.dev',
    content:
      'Strict selection is the feature that makes a demo like this stay honest. If a component did not select content, content is not part of its usable data. That protects teams from accidental coupling, makes refactors smaller, and gives code generation tools a predictable surface.',
    likes: 87,
    title: 'Data masking as a team contract',
  },
  {
    authorEmail: 'hana@nakazawa.dev',
    content:
      'fate stores records by __typename and id, then points roots and lists at those records. That is why liking a post can update every view that selected likes without touching views that only selected title. The cache may know more about an object, but each component only sees the fields its view requested.',
    likes: 111,
    title: 'A normalized cache without manual key math',
  },
  {
    authorEmail: 'jamal@nakazawa.dev',
    content:
      'The React integration leans on Suspense instead of local loading flags. A root useRequest call can suspend while the composed selection is fetched, and errors bubble to normal error boundaries. The components underneath can stay focused on rendering masked data.',
    likes: 76,
    title: 'Suspense-first screens with useRequest',
  },
  {
    authorEmail: 'kai@nakazawa.dev',
    content:
      'Actions in fate are exposed for useActionState, and mutations can carry an optimistic object alongside the input. The cache applies the optimistic update immediately, re-renders affected views, and rolls the affected records back if the server rejects the mutation.',
    likes: 82,
    title: 'Optimistic actions that roll back cleanly',
  },
  {
    authorEmail: 'lena@nakazawa.dev',
    content:
      'The comments under each post use connection-style lists so the UI can load more without inventing a pagination protocol per screen. fate tracks cursor arguments as part of the list state, merges pages into the same connection, and keeps the records normalized.',
    likes: 69,
    title: 'Connection lists for comments and feeds',
  },
  {
    authorEmail: 'mika@nakazawa.dev',
    content:
      'useLiveView has the same shape as useView, but it subscribes to updates for the selected object through the native live transport. The client keeps one SSE stream open, sends subscribe and unsubscribe control messages, and merges returned records into the same normalized cache.',
    likes: 104,
    title: 'Live views over a single SSE stream',
  },
  {
    authorEmail: 'alex@example.com',
    content:
      'The launch post introduced fate with tRPC, but the repo now includes a native HTTP transport too. The Vite plugin wires the client to a fate endpoint, sends requests through the protocol package, and uses GET and POST routes for live updates.',
    likes: 88,
    title: 'Native HTTP transport after the alpha launch',
  },
  {
    authorEmail: 'ari@nakazawa.dev',
    content:
      'The server adapters now cover Prisma and Drizzle with the same data view concepts. Sources describe how to resolve records, fields, lists, counts, and computed values, while fate builds the selected shape for the client. The React component model stays the same.',
    likes: 84,
    title: 'Prisma and Drizzle source adapters',
  },
  {
    authorEmail: 'dina@nakazawa.dev',
    content:
      'The code generator is now optional for CI and custom workflows because the Vite plugin handles the common path during development. The plugin generates the typed client from the server surface, keeps imports fresh, and reduces the number of manual setup steps in a new app.',
    likes: 91,
    title: 'The Vite plugin replaces everyday codegen',
  },
  {
    authorEmail: 'hana@nakazawa.dev',
    content:
      'The cache tracks retained requests so screens can release data when they unmount and let garbage collection clean up records that are no longer needed. For manual client.request calls, code can retain the descriptor for as long as the work needs it.',
    likes: 58,
    title: 'Garbage collection for request lifetimes',
  },
  {
    authorEmail: 'jamal@nakazawa.dev',
    content:
      'Stable refs were a small change with a large ergonomic payoff. When a record has not changed, fate can keep ViewRefs stable across renders, which helps memoized components and reduces avoidable updates. Rendering stays tied to the selected fields, not the full server response.',
    likes: 67,
    title: 'Stable refs and smaller rerenders',
  },
  {
    authorEmail: 'kai@nakazawa.dev',
    content:
      'Migrating from request-centric libraries starts with a mindset shift. Instead of passing server data down as custom prop types, define small views next to the components that render them and compose those views at the route. Mutations and live updates can then update records by object identity.',
    likes: 79,
    title: 'Moving away from request-centric state',
  },
] as const;

export const comments = [
  'The view-first framing is the clearest way I have seen to explain why request hooks create so much incidental state.',
  'Passing ViewRefs through components made the example easier to read than a stack of custom DTO types.',
  'Strict selection caught a missing field in my test component immediately, which is exactly the kind of failure I want.',
  'The normalized cache explanation finally connected likes, comments, and detail pages for our team.',
  'Suspense at the request root keeps the route code small, and the error boundary story feels like normal React.',
  'The useActionState integration is practical because the form code still looks like React.',
  'Connection lists are a good fit for this demo because the small home feed forces loadNext to be exercised.',
  'The single SSE connection model is reassuring; we were worried live views would create one stream per card.',
  'Native HTTP transport makes adoption easier for teams that like the fate model but are not on tRPC.',
  'Having Prisma and Drizzle examples side by side makes the server adapter story much more concrete.',
  'The Vite plugin removing the regular codegen step will help a lot in demos and fresh projects.',
  'Explicit retain and release behavior answers the question of how long normalized data should live.',
  'Stable refs should make a visible difference in large feeds with memoized cards.',
  'The migration checklist is realistic because it starts with one screen instead of a full rewrite.',
  'Search results and detail pages sharing Post records is a good way to show the cache doing real work.',
  'Optimistic likes are simple, but they make the rollback behavior easy to test in front of someone.',
  'The data masking examples should be required reading before anyone adds fields to a shared component.',
  'I like that the posts use product language instead of pretending this is a generic social network.',
  'The HTTP transport post answers the biggest question I had after reading the original announcement.',
  'Garbage collection is easy to ignore until a long-lived app starts leaking records during navigation.',
  'The stable ref change sounds small, but it explains a lot of the rerender fixes in the history.',
  'I used the strict selection post to explain why overfetching is not just a network problem.',
  'The native protocol should make it easier to build examples outside of Hono and tRPC.',
  'The Vite plugin note clarifies how fate connects the client APIs without making codegen part of the app workflow.',
  'The migration sequence matches how we would try this inside an existing dashboard.',
  'The comments list is long enough now to exercise load-more behavior without creating fake lorem ipsum.',
  'Seeing optimistic actions and live updates use the same normalized cache is the key idea.',
  'I would link the stable refs note from the performance section of the docs.',
  'The source adapter post helped our backend team map data views to our existing models.',
  'The React integration posts make it clear that fate is not trying to replace React state.',
  'The cache lifetime post is a good reminder to retain manual requests outside React.',
  'The search route feels more convincing when it can find live views, adapters, and migration content.',
  'The examples now cover the features added after the announcement instead of stopping at the initial alpha.',
  'I like that the same records can appear in the feed, search, and detail pages without duplicate cache data.',
] as const;
