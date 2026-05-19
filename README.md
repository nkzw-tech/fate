<!-- auto-generated from docs/guide/*.md. Do not edit directly. -->

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="/public/fate-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="/public/fate-logo.svg">
    <img alt="Logo" src="/public/fate-logo.svg" width="50%">
  </picture>
</p>

**_fate_** is a modern data client for React inspired by [Relay](https://relay.dev/) and [GraphQL](https://graphql.org/). It combines view composition, normalized caching, data masking, Async React features, and type-safe data fetching.

### Features

- **View Composition:** Components declare their data requirements using co-located "views". Views are composed into a single request per screen, minimizing network requests and eliminating waterfalls.
- **Normalized Cache:** fate maintains a normalized cache for all fetched data. This enables efficient data updates through actions and mutations and avoids stale or duplicated data.
- **Data Masking & Strict Selection:** fate enforces strict data selection for each view, and masks (hides) data that components did not request. This prevents accidental coupling between components and reduces overfetching.
- **Async React:** fate uses modern Async React features like Actions, Suspense, and `use` to support concurrent rendering and enable a seamless user experience.
- **Lists & Pagination:** fate provides built-in support for connection-style lists with cursor-based pagination, making it easy to implement infinite scrolling and "load-more" functionality.
- **Optimistic Updates:** fate supports declarative optimistic updates for mutations, allowing the UI to update immediately while the server request is in-flight. If the request fails, the cache and its associated views are rolled back to their previous state.
- **Live Views:** fate can keep individual view refs up to date through a single native Server-Sent Events stream, merging updates into the normalized cache.
- **AI-Ready:** fate's minimal, predictable API and explicit data selection enable local reasoning, enabling humans and AI tools to generate stable, type-safe data-fetching code.

### A modern data client for React

**_fate_** is designed to make data fetching and state management in React applications more composable, declarative, and predictable. The framework has a minimal API, no DSL, and no magic—_it's just JavaScript_.

GraphQL and Relay introduced several novel ideas: fragments co‑located with components, [a normalized cache](https://relay.dev/docs/principles-and-architecture/thinking-in-graphql/#caching-a-graph) keyed by global identifiers, and a compiler that hoists fragments into a single network request. These innovations made it possible to build large applications where data requirements are modular and self‑contained.

[Nakazawa Tech](https://nakazawa.tech) builds apps and [games](https://athenacrisis.com) primarily with GraphQL and Relay. We advocate for these technologies in [talks](https://www.youtube.com/watch?v=rxPTEko8J7c&t=36s) and provide templates ([server](https://github.com/nkzw-tech/server-template), [client](https://github.com/nkzw-tech/web-app-template/tree/with-relay)) to help developers get started quickly.

However, GraphQL comes with its own type system and query language. If you are already using tRPC or another type‑safe RPC framework, it's a significant investment to adopt and implement GraphQL on the backend. This investment often prevents teams from adopting Relay on the frontend.

Many React data frameworks lack Relay's ergonomics, especially fragment composition, co-located data requirements, predictable caching, and deep integration with modern React features. Optimistic updates usually require manually managing keys and imperative data updates, which is error-prone and tedious.

_fate_ takes the great ideas from Relay and applies them to plain TypeScript data fetching. You get type safety between the client and server, a native protocol with optional adapters such as tRPC, and GraphQL-like ergonomics for data fetching. Using _fate_ usually looks like this:

```tsx
export const PostView = view<Post>()({
  author: UserView,
  content: true,
  id: true,
  title: true,
});

export const PostCard = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  const post = useView(PostView, postRef);

  return (
    <Card>
      <h2>{post.title}</h2>
      <p>{post.content}</p>
      <UserCard user={post.author} />
    </Card>
  );
};
```

_[Learn more](/docs/guide/getting-started.md) about fate's core concepts or create an app from one of the templates._

## Getting Started

### Template

Create a new fate app with Vite+:

```bash
vp create fate my-app
```

The template selector can create a Void app with Drizzle, a tRPC app with Drizzle or Prisma, a GraphQL app with Prisma, or a fate client for an existing GraphQL server. The template sources live in the fate repo under [`packages/create-fate/templates/fate`](https://github.com/nkzw-tech/fate/tree/main/packages/create-fate/templates/fate). They feature modern tools to deliver an incredibly fast development experience.

### Manual Installation

**_fate_** requires React 19.2+. For a React client, install `react-fate`:

::: code-group

```bash [npm]
npm add react-fate
```

```bash [pnpm]
pnpm add react-fate
```

```bash [yarn]
yarn add react-fate
```

:::

If your server is a separate package, install `@nkzw/fate` there as a runtime dependency too. Install `@nkzw/fate` on the client only for a barebones integration without React:

::: code-group

```bash [npm]
npm add @nkzw/fate
```

```bash [pnpm]
pnpm add @nkzw/fate
```

```bash [yarn]
yarn add @nkzw/fate
```

:::

> [!WARNING]
>
> **_fate_** is currently in alpha and not production ready. If something doesn't work for you, please open a pull request.

If you'd like to try the example app in GitHub Codespaces, click the button below:

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new?repo=nkzw-tech/fate)

## Core Concepts

**_fate_** has a minimal API surface and is aimed at reducing data fetching complexity.

### Thinking in Views

In fate, each component declares the data it needs using views. Views are composed upward through the component tree until they reach a root, where the actual request is made. fate fetches all required data in a single request. React Suspense manages loading states, and any data-fetching errors naturally bubble up to React error boundaries. This eliminates the need for imperative loading logic or manual error handling.

Traditionally, React apps are built with components and hooks. fate introduces a third primitive: views – a declarative way for components to express their data requirements. An app built with fate looks more like this:

<p align="center">
  <picture class="fate-tree">
    <source media="(prefers-color-scheme: dark)" srcset="/public/fate-tree-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="/public/fate-tree.svg">
    <img alt="Tree" src="/public/fate-tree.svg" width="90%">
  </picture>
</p>

With fate, you no longer worry about _when_ to fetch data, how to coordinate loading states, or how to handle errors imperatively. You avoid overfetching, stop passing unnecessary data down the tree, and eliminate boilerplate types created solely for passing server data to child components.

> [!NOTE]
> Views in _fate_ are what fragments are in GraphQL.

## Views

### Defining Views

Let's start by defining a simple view for a blog's `Post` component. fate requires you to explicitly "select" each field that you plan to use in your components. Here is how you can define a view for a `Post` entity that has `title` and `content` fields:

```tsx
import { view } from 'react-fate';

type Post = {
  content: string;
  id: string;
  title: string;
};

export const PostView = view<Post>()({
  content: true,
  id: true,
  title: true,
});
```

Fields are selected by setting them to `true` in the view definition. This tells **_fate_** that these fields should be fetched from the server and made available to components that use this view.

> [!NOTE]
> The `Post` type above is an example. In a real application, this type is defined on the server and imported into your client code.

### Resolving a View with `useView`

Now we can use the view that we defined in a `PostCard` React component to resolve the data against a reference of an individual `Post`:

```tsx
import { useView, ViewRef } from 'react-fate';

export const PostCard = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  const post = useView(PostView, postRef);

  return (
    <Card>
      <h2>{post.title}</h2>
      <p>{post.content}</p>
    </Card>
  );
};
```

A `ViewRef` is a reference to a concrete object of a specific type, for example a `Post` with id `7`. It contains the unique ID of the object, the type name (as `__typename`) and some fate-specific metadata. fate creates and manages these references for you, and you can pass them around your components as needed.

Components using `useView` listen to changes for all selected fields. When data changes, fate re-renders all of the fields that depend on that data. For example, if the `title` of the `Post` changes, the `PostCard` component re-renders with new data. However, if a different field such as `likes` that isn't selected in `PostView` changes, the `PostCard` component will not re-render.

### Fetching Data with `useRequest`

Now that we defined our view and component, we fetch the data from the server using the `useRequest` hook from fate. This hook allows us to declare what data we need for a specific screen or component tree. At the root of our app, we can request a list of posts like this:

```tsx
import { useRequest } from 'react-fate';
import { PostCard, PostView } from './PostCard.tsx';

export function App() {
  const { posts } = useRequest({ posts: { list: PostView } });

  return posts.map((post) => <PostCard key={post.id} post={post} />);
}
```

_Learn more about `useRequest` in the [Requests Guide](/docs/guide/requests.md)._

### Composing Views

In the above example we are defining a single view for a `Post`. One of fate's core strengths is view composition. Let's say we want to show the author's name along with the post. A simple way to do this is by adding an `author` field to the `PostView` with a concrete selection:

```tsx
import { Suspense } from 'react';
import { useView, ViewRef } from 'react-fate';

export const PostView = view<Post>()({
  author: {
    id: true,
    name: true,
  },
  content: true,
  id: true,
  title: true,
});

const PostCard = ({ postRef }: { postRef: ViewRef<'Post'> }) => {
  const post = useView(PostView, postRef);
  return (
    <Card>
      <h2>{post.title}</h2>
      <p>by {post.author.name}</p>
      <p>{post.content}</p>
    </Card>
  );
};
```

This code fetches the author associated with the Post and makes it available to the `PostCard` component. However, this approach has some downsides:

1. The `author` selection is tightly coupled to the `PostView`. If we want to use the author's data in another component, we would need to duplicate the field selection.
1. If the `author` has more fields that we want to use in other components, we would need to add them to the `PostView`, leading to overfetching.
1. We cannot reuse the `author` field selection in other views or components.

In fate, views are composable and reusable. Instead of inlining the selection, we can define a `UserView` and compose it into the `PostView` like this:

```tsx
import type { Post, User } from '@your-org/server/views';
import { view } from 'react-fate';

export const UserView = view<User>()({
  id: true,
  name: true,
  profilePicture: true,
});

export const PostView = view<Post>()({
  author: UserView,
  content: true,
  id: true,
  title: true,
});
```

Now we can create a separate `UserCard` component that uses our `UserView`:

```tsx
import { useView, ViewRef } from 'react-fate';

export const UserCard = ({ user: userRef }: { user: ViewRef<'User'> }) => {
  const user = useView(UserView, userRef);

  return (
    <div>
      <img src={user.profilePicture} alt={user.name} />
      <p>{user.name}</p>
    </div>
  );
};
```

And update `PostCard` to use our `UserCard` component:

```tsx
import { UserCard } from './UserCard.tsx';

export const PostCard = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  const post = useView(PostView, postRef);

  return (
    <Card>
      <h2>{post.title}</h2>
      <UserCard user={post.author} />
      <p>{post.content}</p>
    </Card>
  );
};
```

### View Spreads

When building complex UIs, you will often build multiple components that share the same data requirements. In fate, you can use view spreads to compose such views together. This is similar to GraphQL fragment spreads, but works with plain JavaScript objects.

Let's assume we want to fetch and display additional information about the author in the `PostCard`, such as their bio. Instead of directly assigning our `UserView` to the `author` field, we can instead spread it and add the `bio` field:

```tsx
export const PostView = view<Post>()({
  author: {
    ...UserView,
    bio: true,
  },
  content: true,
  id: true,
  title: true,
});
```

Now the `PostCard` component can access the `bio` field of the author:

```tsx
export const PostCard = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  const post = useView(PostView, postRef);

  return (
    <Card>
      <h2>{post.title}</h2>
      <UserCard author={post.author} />
      {/* Accessing the bio field */}
      <p>{post.author.bio}</p>
      <p>{post.content}</p>
    </Card>
  );
};
```

We can also spread multiple views together. For example, if we have another view called `UserStatsView` that selects some statistics about the user, we can include it in the `PostView` like this:

```tsx
export const UserStatsView = view<User>()({
  followerCount: true,
  postCount: true,
});

export const PostView = view<Post>()({
  author: {
    ...UserView,
    ...UserStatsView,
    bio: true,
  },
  content: true,
  id: true,
  title: true,
});
```

Views are opaque objects. Even if you select the same field multiple times through different views, the composed object won't have conflicting fields or result in TypeScript errors. fate automatically deduplicates fields during runtime and ensures that each field is only fetched once.

### `useView` and Suspense

We learned that `useRequest` is responsible for fetching data from the server and `useView` is used for reading data from the cache. In some situations data may not be available in the cache and `useView` might need to suspend the component to fetch only the missing data. Once that data is fetched and written to the cache, the component resumes rendering.

_Tip: You can test this behavior in development mode with Fast Refresh (HMR) enabled in your bundler. When you edit the selection of a view, components using that view will suspend, fetch the missing data, and then resume rendering._

### Type Safety and Data Masking

fate provides guarantees through TypeScript and during runtime that prevent you from accessing data that wasn't selected in a component. This ensures that you declare all the data dependencies at the right level in your component tree, and prevents accidental coupling between components.

In the below example, we forgot to select the `content` of a `Post`. As a result, type-checks fail and the `content` field is undefined during runtime:

```tsx
const PostView = view<Post>()({
  id: true,
  title: true,
  // `content: true` is omitted.
});

const PostCard = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  const post = useView(PostView, postRef);

  return (
    <Card>
      <h2>{post.title}</h2>
      {/* TypeScript errors here, and `post.content` is undefined during runtime */}
      <p>{post.content}</p>
    </Card>
  );
};
```

Views can only be resolved against refs that include that view directly or via view spreads. If a component tries to resolve a view against a ref that isn't linked, it will throw an error during runtime:

```tsx
const PostDetailView = view<Post>()({
  content: true,
});

const AnotherPostView = view<Post>()({
  content: true,
});

const PostView = view<Post>()({
  id: true,
  title: true,
  ...AnotherPostView,
});

const PostCard = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  const post = useView(PostView, postRef);
  return <PostDetail post={post} />;
};

const PostDetail = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  // This throws because the post reference passed into this component
  // is of type `AnotherPostView`, not `PostDetailView`.
  const post = useView(PostDetailView, postRef);
};
```

ViewRefs carry a set of view names they can resolve. `useView` throws if a ref does not include the required view.

## Requests

### Requesting Lists

The `useRequest` hook can be used to declare our data needs for a specific screen or component tree. At the root of our app, we can request a list of posts like this:

```tsx
import { useRequest } from 'react-fate';
import { PostCard, PostView } from './PostCard.tsx';

export function App() {
  const { posts } = useRequest({ posts: { list: PostView } });
  return posts.map((post) => <PostCard key={post.id} post={post} />);
}
```

This component suspends or throws errors, which bubble up to the nearest error boundary. Wrap your component tree with `ErrorBoundary` and `Suspense` components to show error and loading states:

```tsx
<ErrorBoundary FallbackComponent={ErrorComponent}>
  <Suspense fallback={<div>Loading…</div>}>
    <App />
  </Suspense>
</ErrorBoundary>
```

> [!NOTE]
>
> `useRequest` may issue multiple operations in the same render pass. fate transports can batch those operations into fewer network requests: the native HTTP transport batches same-microtask operations into one `POST /fate` request, and the tRPC adapter can use tRPC's [HTTP Batch Link](https://trpc.io/docs/client/links/httpBatchLink).

### Requesting Objects by ID

If you want to fetch data for a single object instead of a list, you can specify the `id` and the associated `view` like this:

```tsx
const { post } = useRequest({
  post: { id: '12', view: PostView },
});
```

If you want to fetch multiple objects by their IDs, you can use the `ids` field:

```tsx
const { posts } = useRequest({
  posts: { ids: ['6', '7'], view: PostView },
});
```

### Other Types of Requests

For any other queries, pass only the `type` and `view`:

```tsx
const { viewer } = useRequest({
  viewer: { view: UserView },
});
```

### Request Arguments

You can pass arguments to `useRequest` calls. This is useful for pagination, filtering, or sorting. For example, to fetch the first 10 posts, you can do the following:

```tsx
const { posts } = useRequest({
  posts: {
    args: { first: 10 },
    list: PostView,
  },
});
```

Request arguments are part of the cache key. Two list requests for the same root with different filters or sorting arguments keep separate list state, and cursor arguments are merged into the same list when you load more pages. The selected view is part of the key as well: requesting `PostCardView` and `PostDetailView` can share normalized records, but fate still tracks whether the specific fields for each request are present.

### Request Modes

`useRequest` supports different request modes to control caching and data freshness. The available modes are:

- `cache-first` (_default_): Returns data from the cache if available, otherwise fetches from the network.
- `stale-while-revalidate`: Returns data from the cache and simultaneously fetches fresh data from the network.
- `network-only`: Always fetches data from the network, bypassing the cache.

You can pass the request mode as an option to `useRequest`:

```tsx
const { posts } = useRequest(
  {
    posts: { list: PostView },
  },
  {
    mode: 'stale-while-revalidate',
  },
);
```

### Cache Lifetime

fate stores records in a normalized cache keyed by `__typename` and `id`. Lists and root queries point at those records, and views read from the normalized cache. When a `useRequest` call is mounted, fate retains the request so the records and lists needed by that screen stay in memory. When the component unmounts, the request is released and fate schedules garbage collection.

Released requests are kept in a small release buffer before their data becomes collectible. This makes common route transitions cheap: navigating away from a screen and quickly coming back usually reuses the cached records instead of refetching them. The default release buffer stores the 10 most recently released requests.

You can tune the buffer when creating the client:

```tsx
const fate = createClient({
  gcReleaseBufferSize: 20,
  roots,
  transport,
  types,
});
```

Set `gcReleaseBufferSize` to `0` in tests or very memory-sensitive environments when released screens should be collected immediately.

`cache-first` request handles are stable while their request is cached. If garbage collection later removes the data for a fulfilled request, the next `cache-first` request automatically fetches it again rather than returning stale references.

If you call `fate.request(...)` outside React and need the result to stay in memory across manual `gc()` calls, retain the same request for the lifetime of that work:

```tsx
const request = { posts: { list: PostView } };
const retained = fate.retain(request);

try {
  const { posts } = await fate.request(request);
  // Use posts while this request is retained.
} finally {
  retained.dispose();
}
```

Garbage collection waits for active optimistic updates to settle before sweeping records. This keeps temporary optimistic records and their list positions stable while mutations are still pending.

## List Views

### Pagination with `useListView`

You can wrap a list of references using `useListView` to enable connection-style lists with pagination support.

For example, you can define a `CommentView` and reuse it inside of a `CommentConnectionView`:

```tsx
import { useListView, ViewRef } from 'react-fate';

const CommentView = view<Comment>()({
  content: true,
  id: true,
});

const CommentConnectionView = {
  args: { first: 10 },
  items: {
    node: CommentView,
  },
};

const PostView = view<Post>()({
  comments: CommentConnectionView,
});
```

Now you can apply the `useListView` hook inside of your `PostCard` component to read the list of comments and load more comments when needed:

```tsx
export function PostCard({ detail, post: postRef }: { detail?: boolean; post: ViewRef<'Post'> }) {
  const post = useView(PostView, postRef);
  const [comments, loadNext] = useListView(CommentConnectionView, post.comments);

  return (
    <div>
      {comments.map(({ node }) => (
        <CommentCard comment={node} key={node.id} post={post} />
      ))}
      {loadNext ? (
        <Button onClick={loadNext} variant="ghost">
          Load more comments
        </Button>
      ) : null}
    </div>
  );
}
```

If `loadNext` is undefined, it means there are no more comments to load. If you want to instead load previous comments, you can use the third argument returned by `useListView`, which is `loadPrevious`. Similarly, if there are no previous comments to load, `loadPrevious` will be undefined.

### Pagination Arguments

Connection views can define default arguments, and `useListView` carries those arguments forward when loading more pages:

```tsx
const CommentConnectionView = {
  args: { first: 10 },
  items: {
    cursor: true,
    node: CommentView,
  },
  pagination: {
    hasNext: true,
    hasPrevious: true,
    nextCursor: true,
    previousCursor: true,
  },
};
```

When `loadNext` runs, fate sends the next cursor as `after` and keeps the page size in `first`. When `loadPrevious` runs, fate sends the previous cursor as `before` and uses `last` for the page size. This lets the server distinguish forward and backward pagination while keeping the component API small.

Additional arguments on a root request are scoped to that root list:

```tsx
const { posts } = useRequest({
  posts: {
    args: { categoryId: category.id, first: 20 },
    list: PostConnectionView,
  },
});
```

The `categoryId` list above has its own cache entry and pagination state. Loading another page for that list does not update a different `posts` request with another category or search query.

## Live Views

`useLiveView` resolves a `ViewRef` just like `useView`, but also keeps the selected object up to date through the native live SSE transport.

```tsx
import { useLiveView, ViewRef } from 'react-fate';

export const PostCard = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  const post = useLiveView(PostView, postRef);

  return (
    <Card>
      <h2>{post.title}</h2>
      {/* Updates automatically! */}
      <p>{post.likes} likes</p>
    </Card>
  );
};
```

The API mirrors `useView`: pass a view and a ref, and get back the same masked data shape. A `null` ref returns `null` and does not subscribe.

### How Live Updates Work

The native HTTP transport opens one Server-Sent Events (SSE) connection per fate client. When components mount or unmount live views, the client sends subscribe and unsubscribe control messages to the server. The server keeps those selections on the connection and sends updates only for records that connection subscribed to.

When the server sends an update, fate normalizes the selected record into the same cache used by requests, actions, and mutations. Components that read affected fields re-render automatically.

For example, if `PostView` selects `likes`, a live update that changes `likes` re-renders the `PostCard`. If another component only selected `title`, it does not re-render for a `likes` change.

Live deletion events remove the record from the normalized cache in the same way as mutations, and any lists or object fields that reference it are pruned.

### Client Setup

Configure the native transport and point the client at your fate endpoint:

```tsx
import { FateClient } from 'react-fate';
import { createFateClient } from 'react-fate/client';

export function App() {
  const fate = useMemo(
    () =>
      createFateClient({
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            credentials: 'include',
          }),
        url: `${env('SERVER_URL')}/fate`,
      }),
    [],
  );

  return <FateClient client={fate}>{/* Components go here */}</FateClient>;
}
```

> [!NOTE]
>
> Live views use `GET /fate/live` for the single SSE stream and `POST /fate/live` for subscribe/unsubscribe control messages.

### Server Setup

Live views use an event bus. By default, the bus signals that an object changed and fate refetches the selected object through the same data view pipeline used by `byId` queries before sending it to the client. Update events can also include changed field paths so fate only resolves the intersection of those paths and each active subscription.

Pass a live event bus to `createFateServer` and expose the native handler:

```tsx
import { createFateServer, createHonoFateHandler, createLiveEventBus } from '@nkzw/fate/server';
import type { AppContext } from './context.ts';
import { sources } from './sources.ts';
import { Root } from './views.ts';

export const live = createLiveEventBus();

export const fate = createFateServer<AppContext>({
  live,
  roots: Root,
  sources,
});

app.all('/fate/*', createHonoFateHandler(fate));
```

fate keeps a bounded in-memory queue for each native SSE connection while live events are waiting to be resolved and sent. The default limit is `1000` queued events per connection. If a client falls behind and exceeds the limit, fate closes that live connection so server memory cannot grow without bound. You can tune the limit by passing the object form:

```tsx
export const fate = createFateServer<AppContext>({
  live: {
    bus: live,
    maxQueueSize: 500,
  },
  roots: Root,
  sources,
});
```

Once this is in place, components can switch from `useView` to `useLiveView` without changing their view definitions or return types.

### Live List Views

`useLiveListView` mirrors `useListView`, but subscribes to live connection events for the connection it receives:

```tsx
import { useLiveListView, useLiveView, ViewRef } from 'react-fate';

export function PostCard({ post: postRef }: { post: ViewRef<'Post'> }) {
  const post = useLiveView(PostView, postRef);
  const [comments, loadNext] = useLiveListView(CommentConnectionView, post.comments);

  return (
    <>
      {comments.map(({ node }) => (
        <CommentCard comment={node} key={node.id} />
      ))}
      {loadNext ? <button onClick={loadNext}>Load more</button> : null}
    </>
  );
}
```

The hook returns the same tuple as `useListView`: items, `loadNext`, and `loadPrevious`. Live events append, prepend, insert, or delete edges from one connection without deleting the underlying records.

By default, live appends and prepends respect pagination boundaries. If the relevant edge still has more pages, fate keeps the incoming node attached to that edge instead of expanding the loaded window. For chat or activity streams where new items should keep appearing immediately, opt into visible live insertion on the connection view:

```tsx
const MessageConnectionView = {
  args: { first: 30 },
  items: {
    node: MessageView,
  },
  live: {
    append: 'visible',
  },
};
```

Emit connection events on the server when list membership changes:

```tsx
live.connection('Post.comments', { id: postId }).prependNode('Comment', comment.id);
live.connection('Post.comments', { id: postId }).deleteEdge('Comment', comment.id);
```

For root lists, use the generated root procedure name:

```tsx
live.connection('posts', { categoryId }).prependNode('Post', post.id);
```

If the changed list cannot be described precisely, invalidate the active connection and fate will refetch it:

```tsx
live.connection('posts', { categoryId }).invalidate();
```

Connection identity follows Relay's model: pagination args like `first`, `last`, `after`, and `before` are ignored for live connection matching, while filter args such as `categoryId` are part of the identity.

### Emitting Events

After a mutation changes an object, emit an update event for that object:

```tsx
export const postRouter = router({
  ...fate.procedures({
    view: postDataView,
  }),
  like: procedure.input(likeInput).mutation(async ({ ctx, input }) => {
    const post = await ctx.prisma.post.update({
      data: {
        likes: {
          increment: 1,
        },
      },
      where: { id: input.id },
    });

    live.update('Post', input.id);

    return post;
  }),
});
```

This tells fate that the `Post` changed. Every active live view for that post refreshes using the selection it subscribed with.

If you know which fields changed, pass them with `changed` to reduce the amount of data sent to each subscriber:

```tsx
live.update('Post', input.id, { changed: ['likes'] });
```

With this version, a live view that selected `likes` refreshes only `likes`, while a live view that only selected unrelated fields is skipped entirely.

If a mutation changes a related object, emit for the object whose live view should refresh. For example, adding a comment usually changes the post's `commentCount` and `comments` list, so emit for the `Post`:

```tsx
export const commentRouter = router({
  add: procedure.input(addCommentInput).mutation(async ({ ctx, input }) => {
    const comment = await ctx.prisma.comment.create({
      data: {
        content: input.content,
        postId: input.postId,
      },
    });

    live.update('Post', input.postId, { changed: ['commentCount', 'comments'] });

    return comment;
  }),
});
```

For deletions, emit a delete event for the deleted object if clients may be subscribed to it:

```tsx
live.delete('Comment', input.id);
```

If deleting the object also changes another object, emit an update for that object too:

```tsx
live.update('Post', postId, { changed: ['commentCount', 'comments'] });
```

You can pass an `eventId` when emitting. fate sends it on the native SSE event and includes the last received event ID when it resubscribes after a reconnect:

```tsx
live.update('Post', input.id, {
  changed: ['likes'],
  eventId: `post:${input.id}:${Date.now()}`,
});
```

The default `createLiveEventBus` is an in-memory fanout bus and does not replay events that were emitted while a client was disconnected. Use a durable custom live bus if your deployment needs reconnects to catch up from `lastEventId`; otherwise the client receives future live events after it reconnects.

### Error Handling

Live subscription errors are reported out of band. They do not replace the last cached data or throw through the component that called `useLiveView`.

Pass `onLiveError` when creating the client to send those failures to your logger or monitoring system:

```tsx
const fate = createFateClient({
  fetch: (input, init) =>
    fetch(input, {
      ...init,
      credentials: 'include',
    }),
  onLiveError(error) {
    captureException(error);
  },
  url: `${env('SERVER_URL')}/fate`,
});
```

The handler runs in a microtask after the subscription reports the error. Components continue to read whatever data is currently available in the fate cache.

## Actions

fate does not provide hooks for mutations like traditional data fetching libraries do. Instead, mutations are exposed in two ways:

- `fate.actions` for use with [`useActionState`](https://react.dev/reference/react/useActionState) and React Actions.
- `fate.mutations` for traditional imperative mutation calls.

Server mutations are exposed automatically as actions and mutations by fate's Vite plugin. The transport determines where those mutations are declared:

- With the [native HTTP transport](/docs/guide/server-integration.md#native-fate-protocol), mutations come from the `mutations` object passed to `createFateServer`.
- With the [tRPC adapter](/docs/guide/server-integration.md#trpc-fate-setup), mutations come from tRPC mutation procedures exposed through your fate-enabled router.
- With [Void](/docs/guide/void-integration.md), mutations use the same native fate server shape and are exposed through the Void route helpers.

If you have a mutation named `post.like`, a `LikeButton` component using fate Actions and an async component library could look like this:

```tsx
import { useActionState } from 'react';
import { useFateClient } from 'react-fate';

const LikeButton = ({ post }: { post: { id: string; likes: number } }) => {
  const fate = useFateClient();
  const [result, like] = useActionState(fate.actions.post.like, null);

  return (
    <Button action={() => like({ input: { id: post.id } })}>
      {result?.error ? 'Oops!' : 'Like'}
    </Button>
  );
};
```

If you are not using an async component library, you can use React's `useTransition` to start the action in a transition:

```tsx
const LikeButton = ({ post }: { post: { id: string; likes: number } }) => {
  const fate = useFateClient();
  const [, startTransition] = useTransition();
  const [result, like, isPending] = useActionState(fate.actions.post.like, null);

  return (
    <button
      disabled={isPending}
      onClick={() => {
        startTransition(() =>
          like({
            input: { id: post.id },
          }),
        );
      }}
    >
      {result?.error ? 'Oops!' : 'Like'}
    </button>
  );
};
```

By using `useActionState`, fate Actions integrate with Suspense and concurrent rendering.

### Optimistic Updates

fate Actions support optimistic updates out of the box. For example, to update the post's like count optimistically, you can pass an `optimistic` object to the action call. This will immediately update the cache with the new like count and re-render all views that select the `likes` field:

```tsx
like({
  input: { id: post.id },
  optimistic: { likes: post.likes + 1 },
});
```

When data changes through optimistic updates or otherwise, fate only re-renders the views that select the changed fields. In the above example, only views that select the `likes` field will re-render. If a view only selects the `title` field, it won't re-render when the `likes` field changes.

If a mutation fails, the cache will be rolled back to its previous state and any views depending on the mutated data will be updated.

### Inserting New Objects

When a mutation inserts a new object, you can provide an optimistic object with a temporary ID to represent the new object in the cache until the server responds with the actual ID. For example, to add a new comment to a post optimistically, you can do the following:

```tsx
const content = 'New Comment text';
addComment({
  input: { content, postId: post.id },
  optimistic: {
    author: { id: user.id, name: user.name },
    content,
    id: `optimistic:${Date.now().toString(36)}`,
    post: { commentCount: post.commentCount + 1, id: post.id },
  },
});
```

By default, fate inserts new records after existing items in matching root lists and nested lists. For a newest-first list, pass `insert: 'before'` so optimistic records appear at the beginning:

```tsx
addComment({
  input: { content, postId: post.id },
  insert: 'before',
  optimistic: {
    content,
    id: `optimistic:${Date.now().toString(36)}`,
    post: { id: post.id },
  },
});
```

Insertion respects pagination boundaries. If you append to a list that still has a next page, fate keeps the new record attached to the unresolved trailing edge instead of mixing it into the loaded page. As you load more pages, the inserted record stays at the end until the server returns the canonical item or the list reaches the edge. The same behavior applies to prepends while `hasPrevious` is true.

Multiple pending optimistic inserts keep their visible order. For example, two `insert: 'before'` calls on a newest-first feed show the second optimistic item before the first, matching what users expect from newly created content.

### Selecting a View with Actions

Mutations may change data that is not directly specified in the mutation result. For example, adding a comment increases the post's comment count. For such cases, you can provide a `view` to an action that specifies which fields to fetch as part of the mutation:

```tsx
addComment({
  input: { content: 'New Comment text', postId: post.id },
  view: view<Comment>()({
    ...CommentView,
    post: { commentCount: true },
  }),
});
```

The server will return the selected fields and fate updates the cache and re-renders all views that depend on the changed data. The action result contains the newly added comment with the selected fields:

```tsx
const [result, addComment] = useActionState(fate.actions.comment.add, null);

const newComment = result?.result;
if (newComment) {
  // All the fields selected in the view are available on `newComment`:
  console.log(newComment.post.commentCount);
}
```

### Mutations

fate Actions are the recommended way to execute server mutations in React components. However, there are cases where you might want to call mutations imperatively, outside of React components, or without waiting for previous actions to finish like `useActionState` does. For such cases, you can use `fate.mutations` to call mutations imperatively:

```tsx
const result = await fate.mutations.comment.add({
  input: { content, postId: post.id },
});
```

You can call mutations from anywhere, and without waiting for previous mutations to finish. The mutation API matches the API of fate Actions, including optimistic updates and view selection. With mutations, you'll need to handle loading states and errors manually, and the result is returned as a promise.

### Mutation Server Implementation

fate Actions & Mutations are backed by regular server mutations. If you already know how your fate server is wired, the client-side API above is the same regardless of transport. If not, start with the server setup for your environment:

- [Native HTTP custom mutations](/docs/guide/server-integration.md#custom-mutations) use `createFateServer({ mutations })`.
- [tRPC fate setup](/docs/guide/server-integration.md#trpc-fate-setup) wires fate into your tRPC router; custom writes can use the same `fate.createPlan` and `fate.resolveById` helpers shown there.
- [Void integration](/docs/guide/void-integration.md) exposes a native fate server from Void routes; define mutations with the native `createFateServer({ mutations })` API and serve them through `defineVoidFateRoute`.

Here is a native HTTP mutation for `post.like`:

```tsx
export const fate = createFateServer({
  mutations: {
    'post.like': {
      input: likeInput,
      resolve: async ({ ctx, input, select }) => {
        await ctx.prisma.post.update({
          data: {
            likes: {
              increment: 1,
            },
          },
          where: { id: input.id },
        });

        return sources.resolveById({
          ctx,
          id: input.id,
          input: { select },
          view: postDataView,
        });
      },
      type: 'Post',
    },
  },
  roots: Root,
  sources,
});
```

The equivalent tRPC mutation lives in your router and returns the selected shape that the client asked for:

```tsx
import { z } from 'zod';
import { connectionArgs, createResolver } from '@nkzw/fate/server';
import { procedure, router } from '../init.ts';
import { postDataView, PostItem } from '../views.ts';

export const postRouter = router({
  like: procedure
    .input(
      z.object({
        args: connectionArgs,
        id: z.string().min(1, 'Post id is required.'),
        select: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { resolve, select } = createResolver({
        ...input,
        ctx,
        view: postDataView,
      });

      return resolve(
        await ctx.prisma.post.update({
          data: {
            likes: {
              increment: 1,
            },
          },
          select,
          where: { id: input.id },
        } as PostUpdateArgs),
      );
    }),
});
```

See [Server Integration](/docs/guide/server-integration.md) for complete native HTTP and tRPC setup examples, and [Void Integration](/docs/guide/void-integration.md) for route helpers when your app runs on Void.

### Action & Mutation Error Handling

fate Actions & Mutations separate error handling into two scopes: "call site" and "boundary". Call site errors are expected to be handled at the location where the action or mutation is called. Boundary errors are unexpected errors that should be handled by a higher-level error boundary.

If your server returns a `NOT_FOUND` error with code `404`, the result of an Action or Mutation will contain an error object that you can handle at the call site:

```tsx
const [result] = useActionState(fate.actions.post.delete, null);

if (result?.error) {
  if (result.error.code === 'NOT_FOUND') {
    // Handle not found error at call site.
  } else {
    // Handle other *expected* errors.
  }
}
```

However, if an `INTERNAL_SERVER_ERROR` error with code `500` occurs, it will be thrown and can be caught by the nearest React error boundary:

```tsx
<ErrorBoundary FallbackComponent={ErrorComponent}>
  <Suspense fallback={<div>Loading…</div>}>
    <PostPage postId={postId} />
  </Suspense>
</ErrorBoundary>
```

You can find the error classification behavior in [`mutation.ts`](https://github.com/nkzw-tech/fate/blob/main/packages/fate/src/mutation.ts#L227-L254).

### Deleting Records

When you want to delete a record using fate Actions, you can pass a `delete: true` flag to the action call. This flag removes the object from the cache and re-renders all views that depend on the deleted data:

```tsx
const [result, deleteAction] = useActionState(fate.actions.post.delete, null);

deleteAction({
  input: { id: post.id },
  delete: true,
});
```

### Resetting Action State

When using `useActionState`, the result of the action is cached until the component using the action is unmounted. When a mutation fails with an error, you might want to clear the error state without invoking the action again. fate Actions take a `'reset'` token to reset the action state:

```tsx
const [result, like] = useActionState(fate.actions.post.like, null);

useEffect(() => {
  if (result?.error) {
    // Reset the action state after 3 seconds.
    const timeout = setTimeout(() => startTransition(() => like('reset')), 3000);
    return () => clearTimeout(timeout);
  }
}, [like, result]);
```

### Controlling List Insertion Behavior

When inserting new objects into lists, the default behavior is to append the new object to the list. You can provide an `insert` option with `before`, `after` or `none` values to customize this behavior and specify where the new object should be inserted in the list:

```tsx
addComment({
  input: { content: 'New Comment text', postId: post.id },
  insert: 'before', // Insert the new comment at the beginning of the list.
});
```

Or, use the `none` option if you want to ignore inserting the new object into any lists:

```tsx
addComment({
  input: { content: 'New Comment text', postId: post.id },
  insert: 'none', // Do not insert the new comment into any lists.
});
```

## GraphQL Integration

_fate_ can use an existing GraphQL API as its transport. This keeps the React APIs, view composition, normalized cache, masking, requests, list views, live views, and actions the same while replacing the native or tRPC backend with GraphQL operations.

Use the GraphQL transport when your backend already exposes GraphQL and you want fate's client model without adding fate's native server protocol.

### Template

Create a client for an existing GraphQL server with:

```bash
vp create fate my-app --template graphql-client
```

Create a full GraphQL + Prisma example app with:

```bash
vp create fate my-app --template graphql
```

The client-only template is the smallest reference for the integration. It contains a `src/fate/graphql.ts` file that maps your GraphQL schema to fate views and roots.

### GraphQL Schema Shape

The GraphQL transport expects a schema with Relay-style object identity and pagination:

- Entity objects include `id` and `__typename`.
- Object fetches go through a `nodes(ids:)` field.
- List fields return Relay connections with `edges`, `cursor`, `node`, and `pageInfo`.
- Root queries and mutations return the entity type selected by the fate view.

For example, a `Post` list can be exposed as a normal GraphQL connection:

```graphql
type Query {
  posts(first: Int, after: String): PostConnection!
  viewer: User
  nodes(ids: [ID!]!): [Node]!
}

type PostConnection {
  edges: [PostEdge!]!
  pageInfo: PageInfo!
}
```

If your schema uses different root field names, keep the fate names you want on the client and map them with `fateGraphQL.roots`.

### Mapping Your Schema

Create a module that exports data views, `Root`, and an optional `fateGraphQL` config. The Vite plugin reads this module during development and build time, generates the client wiring, and leaves your runtime GraphQL server unchanged.

```tsx
import { graphqlMutation } from '@nkzw/fate';
import { dataView, list, type Entity } from '@nkzw/fate/server';

type GraphQLUser = {
  id: string;
  name?: string | null;
  username?: string | null;
};

type GraphQLPost = {
  author?: GraphQLUser | null;
  id: string;
  title: string;
};

export const userDataView = dataView<GraphQLUser>('User')({
  id: true,
  name: true,
  username: true,
});

export const postDataView = dataView<GraphQLPost>('Post')({
  author: userDataView,
  id: true,
  title: true,
});

export type User = Entity<typeof userDataView, 'User'>;
export type Post = Entity<
  typeof postDataView,
  'Post',
  {
    author: User | null;
  }
>;

export const Root = {
  posts: list(postDataView),
  viewer: userDataView,
};

export const fateGraphQL = {
  roots: {
    posts: { field: 'posts' },
    viewer: { field: 'viewer' },
  },
} as const;
```

The data views describe the fields React components are allowed to select. `Root` describes the root operations available to `useRequest`. `fateGraphQL.roots` maps those root names to actual GraphQL fields. If the GraphQL field has the same name as the fate root, the `field` entry can be omitted.

### Vite Plugin

Configure the fate Vite plugin with the GraphQL transport and point it at the mapping module:

```tsx
import { fate } from 'react-fate/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    fate({
      module: './src/fate/graphql.ts',
      transport: 'graphql',
    }),
  ],
});
```

The plugin generates a typed `createFateClient` helper from your views, roots, and GraphQL mapping. It also watches the mapping module and the files it imports during development.

### Creating a Client

Create the client with your GraphQL endpoint and provide it through the `FateClient` provider:

```tsx
import { FateClient } from 'react-fate';
import { createFateClient } from 'react-fate/client';

const fate = createFateClient({
  headers: () => ({
    authorization: `Bearer ${token}`,
  }),
  url: 'https://api.example.com/graphql',
});

export function App() {
  return <FateClient client={fate}>{/* Components go here */}</FateClient>;
}
```

Use `fetch` when you need to customize credentials or reuse an application fetch wrapper:

```tsx
const fate = createFateClient({
  fetch: (input, init) =>
    fetch(input, {
      ...init,
      credentials: 'include',
    }),
  url: `${env('SERVER_URL')}/graphql`,
});
```

GraphQL operations issued in the same microtask are batched into a single GraphQL query or mutation document with aliased fields.

### Object IDs

The transport converts between fate entity IDs and GraphQL node IDs. By default, it sends IDs as `${type}-${id}` and strips that prefix from returned IDs. Override this if your schema uses Relay global IDs, raw database IDs, or another encoding:

```tsx
const fate = createFateClient({
  decodeNodeId: (type, id) => {
    const [nodeType, nodeId] = atob(String(id)).split(':');
    if (nodeType !== type) {
      throw new Error(`Expected a ${type} node id.`);
    }
    return nodeId;
  },
  encodeNodeId: (type, id) => btoa(`${type}:${id}`),
  url: '/graphql',
});
```

If your GraphQL API already accepts and returns the same IDs you use in the app, return `id` from both functions.

### Requests and Arguments

Client code keeps using `useRequest` with the same shape as the other transports:

```tsx
const { posts, viewer } = useRequest({
  posts: {
    args: { first: 10 },
    list: PostView,
  },
  viewer: { view: UserView },
});
```

Root arguments are sent to the root GraphQL field. Nested relation arguments are scoped by relation name:

```tsx
const { posts } = useRequest({
  posts: {
    args: {
      comments: { first: 3 },
      first: 10,
    },
    list: PostWithCommentsView,
  },
});
```

This produces a root `posts(first: 10)` field and a nested `comments(first: 3)` field in the generated GraphQL selection.

### Mutations

Map fate mutation names to GraphQL mutation fields with `graphqlMutation`:

```tsx
export const fateGraphQL = {
  mutations: {
    'post.like': graphqlMutation<Post, { id: string }, Post>('Post', {
      field: 'postLike',
    }),
  },
  roots: {
    posts: { field: 'posts' },
  },
} as const;
```

By default, the input is sent as an `input` argument:

```graphql
mutation {
  postLike(input: { id: "12" }) {
    id
    likes
  }
}
```

Use `inputArg` when your schema uses a different argument name, or `inputArg: false` when the input object should be spread into field arguments:

```tsx
export const fateGraphQL = {
  mutations: {
    'post.like': graphqlMutation<Post, { id: string }, Post>('Post', {
      field: 'likePost',
      inputArg: 'payload',
    }),
    'user.follow': graphqlMutation<User, { id: string }, User>('User', {
      field: 'followUser',
      inputArg: false,
    }),
  },
} as const;
```

Actions use the same `mutation(...)` and `useActionState` APIs described in the [Actions Guide](/docs/guide/actions.md).

### Live Views

GraphQL live views use [GraphQL SSE](https://github.com/enisdenjo/graphql-sse). Install `graphql-sse` in the client package and leave `live` enabled, or pass `live: false` when your schema does not support subscriptions.

```tsx
const fate = createFateClient({
  live: {
    url: 'https://api.example.com/graphql/stream',
  },
  url: 'https://api.example.com/graphql',
});
```

The default subscription fields are `fateLiveNode` for `useLiveView` and `fateLiveConnection` for `useLiveListView`. Rename them with `entityField` and `connectionField`:

```tsx
const fate = createFateClient({
  live: {
    connectionField: 'liveConnection',
    entityField: 'liveNode',
    url: '/graphql/stream',
  },
  url: '/graphql',
});
```

The live node subscription returns `{ data, delete, id, select }`. The live connection subscription returns events such as `appendNode`, `prependNode`, `deleteEdge`, and `invalidate`. These payloads match fate's live transport events, so the cache update behavior is the same as the native transport.

If you do not need live views, disable them explicitly:

```tsx
const fate = createFateClient({
  live: false,
  url: '/graphql',
});
```

### Existing Servers

The GraphQL transport is intentionally a mapping layer. It does not require `createFateServer`, the Prisma adapter, or the Drizzle adapter. Your GraphQL server remains responsible for authorization, validation, resolver behavior, cursor pagination, and mutation side effects.

Use data views to expose only the fields the client should be able to select, keep GraphQL schema authorization in your server, and treat `src/fate/graphql.ts` as the contract between your GraphQL API and fate's React client.

## Server Integration

Until now, we have focused on the client-side API of fate. You'll need a backend that can be wired into fate's typed request model so the Vite plugin can connect the typed fate APIs to your app. _fate_ currently ships three integration paths:

- The native fate protocol, which is transport-agnostic and can be hosted by any Fetch-compatible server.
- The tRPC adapter, which keeps compatibility with existing tRPC backends.
- The [GraphQL transport](/docs/guide/graphql-integration.md), which maps fate views and roots to an existing GraphQL schema.

_fate_ currently provides database adapters for Prisma and Drizzle, but the framework itself is not coupled to a particular ORM. The adapters plug into the same source execution runtime and can be exposed through the native protocol or through tRPC.

### Conventions & Object Identity

fate expects that data is served by a backend that follows these conventions:

- A `byId` query for each data type to fetch individual objects by their unique identifier (`id`).
- A `list` query for fetching lists of objects with support for pagination.

Objects are identified by their ID and type name (`__typename`, e.g. `Post`, `User`), and stored by `__typename:id` (e.g. "Post:123") in the client cache. fate keeps list orderings under stable keys derived from the backend procedure and args. Relations are stored as IDs and returned to components as ViewRef tokens.

fate's type definitions might seem verbose at first glance. However, with fate's minimal API surface, AI tools can easily write this code for you, and the Vite plugin takes care of connecting it to your app.

> [!NOTE]
> You can adopt _fate_ incrementally in an existing tRPC codebase without changing your existing schema by adding these queries alongside your existing procedures.

### Data Views

Since clients can send arbitrary selection objects to the server, we need to implement a way to translate these selection objects into database queries without exposing raw database queries and private data to the client. On the client, we define views to select fields on each type. We can do the same on the server using fate data views and the `dataView` function from `@nkzw/fate/server`.

Create a `views.ts` file next to your server entry that exports the data views for each type. The same data view shape works with both Prisma model types and Drizzle row types:

::: code-group

```tsx [Prisma]
import { dataView, type Entity } from '@nkzw/fate/server';
import type { User as PrismaUser } from '../prisma/prisma-client/client.ts';

export const userDataView = dataView<PrismaUser>('User')({
  id: true,
  name: true,
  username: true,
});

export type User = Entity<typeof userDataView, 'User'>;
```

```tsx [Drizzle]
import { dataView, type Entity } from '@nkzw/fate/server';
import type { UserRow } from '../drizzle/schema.ts';

export const userDataView = dataView<UserRow>('User')({
  id: true,
  name: true,
  username: true,
});

export type User = Entity<typeof userDataView, 'User'>;
```

:::

Now that we apply `userDataView` to the `byId` query, the server limits the selection to the fields defined in the data view, keeping private fields hidden from the client, and providing type safety for client views:

```tsx
const UserData = view<User>()({
  // Type-error + ignored during runtime.
  password: true,
});
```

### Data View Composition

Similar to client-side views, data views can be composed of other data views:

```tsx
export const postDataView = dataView<PostItem>('Post')({
  author: userDataView,
  content: true,
  id: true,
  title: true,
});
```

### Data View Lists

Use the `list` helper to define list fields:

```tsx
import { list } from '@nkzw/fate/server';

export const commentDataView = dataView<CommentItem>('Comment')({
  content: true,
  id: true,
});

export const postDataView = dataView<PostItem>('Post')({
  author: userDataView,
  comments: list(commentDataView, { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
});
```

We can define extra root-level lists and queries by exporting a `Root` object from our `views.ts` file using the same view syntax as everywhere else:

```tsx
export const Root = {
  categories: list(categoryDataView, { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
  commentSearch: {
    procedure: 'search',
    view: list(commentDataView, { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
  },
  events: list(eventDataView, { orderBy: [{ startAt: 'asc' }, { id: 'asc' }] }),
  posts: list(postDataView, { orderBy: { createdAt: 'desc', id: 'desc' } }),
  viewer: userDataView,
};
```

Entries that wrap their view in `list(...)` are treated as list resolvers. In the native protocol, the root key is the operation name used by the client. In the tRPC adapter, `procedure` can point that root at a specific router procedure. If you omit `list(...)`, fate treats the entry as a standard query.

You can pass default list options such as `orderBy` to `list(...)`. Ordering is scoped to that specific list wrapper: `Root.posts` can order posts by `createdAt desc`, while `categoryDataView.posts` or `postDataView.comments` can choose their own order. If no order is provided, fate orders by `id asc`. fate always appends `id asc` as a tie-breaker when no `id` order is present; include `id` yourself when you need a different tie-breaker direction such as `id desc`. Use the array form when ordering by multiple fields so the priority is unambiguous.

For the above `Root` definitions, you can make the following requests using `useRequest`:

```tsx
const query = 'Apple';

const { posts, categories, viewer } = useRequest({
  // Explicit Root queries:
  categories: { list: categoryView },
  commentSearch: { args: { query }, list: commentView },
  events: { list: eventView },
  posts: { list: postView },
  viewer: { view: userView },

  // Queries by id, if those entities have a `byId` query defined:
  post: { id: '12', view: postView },
  comment: { ids: ['6', '7'], view: commentView },
});
```

### Native fate protocol

The native protocol keeps tRPC optional. Create a source adapter from your ORM integration, pass it to `createFateServer`, and expose the returned server through a Fetch-compatible handler.

```tsx
import { createFateServer, createHonoFateHandler } from '@nkzw/fate/server';
import { createPrismaSourceAdapter } from '@nkzw/fate/server/prisma';
import { Hono } from 'hono';
import type { AppContext } from './context.ts';
import { prisma } from './prisma.ts';
import { Root, userDataView } from './views.ts';

export { Root } from './views.ts';

const sources = createPrismaSourceAdapter<AppContext>({
  prisma: (ctx) => ctx.prisma,
  views: Root,
});

export const fate = createFateServer({
  context: async ({ adapterContext }) => ({
    prisma,
    request: adapterContext.req.raw,
    sessionUser: await getSessionUser(adapterContext.req.raw),
  }),
  queries: {
    viewer: {
      resolve: ({ ctx, select }) =>
        sources.resolveById({
          ctx,
          id: ctx.sessionUser.id,
          input: { select },
          view: userDataView,
        }),
    },
  },
  roots: Root,
  sources,
});

const app = new Hono();
const handler = createHonoFateHandler(fate);

app.post('/fate', handler);
app.post('/fate/live', handler);
```

Configure the Vite plugin with the native transport:

```tsx
import { fate } from 'react-fate/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    fate({
      module: '@your-org/server/fate.ts',
      transport: 'native',
    }),
  ],
});
```

With the native transport, the Vite plugin handles the HTTP transport setup. If you need to create a client manually, use `createFateClient` with the same route:

```tsx
import { createFateClient } from 'react-fate/client';

const client = createFateClient({
  url: '/fate',
});
```

The HTTP transport batches operations issued in the same microtask into one `POST /fate` request. Live views use one `GET /fate/live` SSE stream per fate client and `POST /fate/live` control messages when views subscribe or unsubscribe.

#### Custom Queries

Root query entries such as `viewer` need an explicit resolver because fate cannot infer application-specific behavior like "current user" from a data view:

```tsx
export const fate = createFateServer({
  context,
  queries: {
    viewer: {
      resolve: ({ ctx, select }) =>
        sources.resolveById({
          ctx,
          id: ctx.sessionUser.id,
          input: { select },
          view: userDataView,
        }),
    },
  },
  roots: Root,
  sources,
});
```

#### Custom Mutations

Mutations declare the entity type they return and receive the selected fields requested by the client. Resolve the updated record through the source adapter so the response has the same masking and relation behavior as regular view requests:

```tsx
export const fate = createFateServer({
  mutations: {
    'post.like': {
      input: likeInput,
      resolve: async ({ ctx, input, select }) => {
        await ctx.prisma.post.update({
          data: { likes: { increment: 1 } },
          where: { id: input.id },
        });

        return sources.resolveById({
          ctx,
          id: input.id,
          input: { select },
          view: postDataView,
        });
      },
      type: 'Post',
    },
  },
  roots: Root,
  sources,
});
```

#### Live Views

Pass a live event bus to enable `useLiveView` over the native SSE endpoint:

```tsx
import { createLiveEventBus } from '@nkzw/fate/server';

export const live = createLiveEventBus();

export const fate = createFateServer({
  live,
  queries: {
    viewer: {
      resolve: ({ ctx, select }) =>
        sources.resolveById({
          ctx,
          id: ctx.sessionUser.id,
          input: { select },
          view: userDataView,
        }),
    },
  },
  roots: Root,
  sources,
});

live.update('Post', post.id, {
  changed: ['likes'],
  eventId: `post:${post.id}:${Date.now()}`,
});
```

`changed` is optional. When provided, fate resolves only the changed fields selected by each live subscription and skips subscriptions that do not select those fields. `createLiveEventBus` is an in-memory fanout bus. It forwards `eventId` to SSE clients, but it does not replay events after reconnects. If your app needs lossless reconnect behavior, provide a durable live bus implementation that uses the `lastEventId` passed to `listen`, `listenConnection`, `subscribe`, and `subscribeConnection`.

Native SSE connections keep a bounded in-memory queue while events are waiting to be resolved and sent. The default is `1000` queued events per connection. If a client falls behind and exceeds that limit, fate closes the live connection instead of buffering indefinitely. Configure it with `live: { bus: live, maxQueueSize: 500 }`.

### tRPC fate setup

The Prisma and Drizzle tRPC integrations connect your data views to your database, bind fate's standard tRPC procedures, and expose helpers for custom queries and mutations.

Pass the `Root` export from `views.ts` to fate in your tRPC `init.ts` file. fate walks that view graph to find the data views it needs. `id` defaults to `"id"`, and fate uses it as the fallback ordering for cursor pagination. Relations are inferred from the data view and ORM schema: a nested data view is loaded as a singular relation, `list(view)` is loaded as a list relation, and Drizzle join tables are discovered from relation metadata.

#### Prisma

Use `createPrismaFate` from `@nkzw/fate/server/prisma` next to your tRPC helpers. By default, fate reads Prisma delegates from `ctx.prisma` using each data view's type name:

```tsx
import { initTRPC } from '@trpc/server';
import { createPrismaFate } from '@nkzw/fate/server/prisma';
import type { AppContext } from './context.ts';
import { Root } from './views.ts';

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const procedure = t.procedure;

export const fate = createPrismaFate<AppContext, typeof procedure>({
  procedure,
  views: Root,
});
```

If your Prisma client is not stored at `ctx.prisma`, pass `prisma: (ctx) => ctx.db`.

The Prisma integration translates view requests into Prisma `select`, `where`, `cursor`, `skip`, and `take` options. It also hydrates computed `count(...)` dependencies using Prisma `groupBy` when needed.

For custom Prisma queries and mutations, use `fate.createPlan` with `toPrismaSelect`:

```tsx
import { toPrismaSelect } from '@nkzw/fate/server';

const plan = fate.createPlan({
  ...input,
  ctx,
  view: postDataView,
});

const post = await ctx.prisma.post.update({
  data: {
    likes: {
      increment: 1,
    },
  },
  select: toPrismaSelect(plan),
  where: { id: input.id },
});

return plan.resolve(post);
```

#### Drizzle

Use `createDrizzleFate` from `@nkzw/fate/server/drizzle`. fate matches data view type names to Drizzle tables from your schema. The `db` option can be a Drizzle database object or a function that receives your tRPC context and returns a request-scoped database object:

```tsx
import { initTRPC } from '@trpc/server';
import { createDrizzleFate } from '@nkzw/fate/server/drizzle';
import db from '../drizzle/db.ts';
import schema from '../drizzle/schema.ts';
import type { AppContext } from './context.ts';
import { Root } from './views.ts';

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const procedure = t.procedure;

export const fate = createDrizzleFate<AppContext, typeof procedure>({
  db,
  procedure,
  schema,
  views: Root,
});
```

If your database lives on the request context, pass a function instead:

```tsx
import schema from '../drizzle/schema.ts';
import { Root } from './views.ts';

export const fate = createDrizzleFate<AppContext, typeof procedure>({
  db: (ctx) => ctx.db,
  procedure,
  schema,
  views: Root,
});
```

The Drizzle adapter builds SQL queries from your registered data views. It selects only requested columns, hydrates singular, list, and many-to-many relations, supports nested cursor pagination, and hydrates computed `count(...)` dependencies with SQL grouped counts. Count filters may be plain equality objects or Drizzle SQL predicates written as `(columns) => eq(columns.status, 'GOING')`.

Nested paginated relations are resolved with one child-page query per parent row. fate runs those child queries with a default concurrency limit of `10` so a single request cannot flood the database connection pool. Tune this with `nestedPaginationConcurrency` if your database pool or workload needs a different limit:

```tsx
export const fate = createDrizzleFate<AppContext, typeof procedure>({
  db,
  nestedPaginationConcurrency: 5,
  procedure,
  schema,
  views: Root,
});
```

For request-specific sorting, prefer a custom root query that validates and translates explicit sort args.

For many-to-many relations, define the join table relations in your Drizzle schema. fate discovers a join table that points at both the source table and the target table:

```tsx
export const fate = createDrizzleFate<AppContext, typeof procedure>({
  db,
  procedure,
  schema,
  views: Root,
});
```

You can still provide explicit join metadata when the schema is ambiguous:

```tsx
{
  manyToMany: {
    tags: {
      foreignColumn: postToTag.tagId,
      localColumn: postToTag.postId,
      table: postToTag,
    },
  },
  relations: {
    tags: {
      foreignKey: 'id',
      localKey: 'id',
      through: {
        foreignKey: 'tagId',
        localKey: 'postId',
      },
    },
  },
  table: post,
  view: postDataView,
}
```

Drizzle writes should stay ordinary Drizzle code. After creating or updating a row, use `fate.resolveById` to return the selected shape that the client asked for:

```tsx
const postId = await createPostRecord({
  authorId: ctx.sessionUser.id,
  content: input.content,
  title: input.title,
});

const post = await fate.resolveById({
  ctx,
  id: postId,
  input,
  view: postDataView,
});

return post;
```

### tRPC Procedures

Use `fate.procedures` to build the standard `byId` and `list` procedures expected by fate's request APIs:

```tsx
import { fate, router } from '../init.ts';
import { postDataView } from '../views.ts';

export const postRouter = router({
  ...fate.procedures(postDataView),
});
```

You can disable the generated `list` procedure if a view should only be fetched by id:

```tsx
export const commentRouter = router({
  ...fate.procedures({
    list: false,
    view: commentDataView,
  }),
});
```

### Custom Queries

You can add custom root queries next to generated procedures. Define the root in `Root`, implement a matching tRPC procedure, and call `fate.resolveConnection`:

```tsx
export const Root = {
  commentSearch: { procedure: 'search', view: list(commentDataView) },
};
```

```tsx
import { ilike } from 'drizzle-orm';
import { fate } from '../init.ts';

export const commentRouter = router({
  ...fate.procedures({
    list: false,
    view: commentDataView,
  }),
  search: fate.connection({
    input: z.object({
      query: z.string().min(1, 'Search query is required'),
    }),
    query: ({ ctx, cursor, direction, input, take }) =>
      fate.resolveConnection({
        ctx,
        cursor,
        direction,
        extra: {
          where: ilike(comment.content, `%${input.args.query}%`),
        },
        input,
        take,
        view: commentDataView,
      }),
  }),
});
```

For Prisma, pass Prisma query options such as `{ where: { ... } }` in `extra` instead of a Drizzle SQL expression.

### Data View Resolvers

fate data views support computed fields. Use `computed`, `field`, and `count` to describe the hidden data needed to resolve a public field:

```tsx
import { computed, count, field } from '@nkzw/fate/server';

export const userDataView = dataView<UserItem>('User')({
  email: computed<UserItem, string | null, AppContext>({
    authorize: ({ id }, context) => context?.sessionUser?.id === id,
    select: {
      email: field('email'),
    },
    resolve: (_item, deps) => (deps.email as string | null) ?? null,
  }),
  id: true,
});

export const postDataView = dataView<PostItem>('Post')({
  commentCount: computed<PostItem, number>({
    select: {
      count: count('comments'),
    },
    resolve: (_item, deps) => (deps.count as number) ?? 0,
  }),
  id: true,
});
```

The adapters fetch the hidden `field(...)` and `count(...)` dependencies for you. This keeps private fields like `email` available to the resolver without exposing them to the client selection.

### Connecting the Client

Now that we have defined our client views and our server module, add fate's Vite plugin to the client app. The plugin reads your server exports and wires the typed fate APIs into your app.

For tRPC, make sure the `router.ts` file exports the `appRouter` object, `AppRouter` type and all the views we have defined:

```tsx
import { router } from './init.ts';
import { postRouter } from './routers/post.ts';
import { userRouter } from './routers/user.ts';

export const appRouter = router({
  post: postRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;

export * from './views.ts';
```

Configure the fate Vite plugin with your server module:

```tsx
import { fate } from 'react-fate/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    fate({
      module: '@your-org/server/trpc/router.ts',
    }),
  ],
});
```

_Note: fate uses the specified server module name to find the server types it needs. Make sure that the module is available to the client package's Vite config._

During development, the plugin watches the server module and the files it imports. When one of those files changes, fate updates the internal client wiring and invalidates `@nkzw/fate/client` in Vite's module graph.

For a barebones client without React, import the plugin from `@nkzw/fate/vite` and the client APIs from `@nkzw/fate/client`. The plugin wires the same server types for the selected import path.

The plugin writes project-local types under `.fate/`. If your TypeScript config does not already include dot-directories, extend the generated config:

```json
{
  "extends": "./.fate/tsconfig.json"
}
```

### Creating a _fate_ Client

Now that the Vite plugin has connected the types, create a fate client instance and provide it to your React app with the `FateClient` context provider:

```tsx
import { httpBatchLink } from '@trpc/client';
import { FateClient } from 'react-fate';
import { createFateClient } from 'react-fate/client';

export function App() {
  const fate = useMemo(
    () =>
      createFateClient({
        links: [
          httpBatchLink({
            fetch: (input, init) =>
              fetch(input, {
                ...init,
                credentials: 'include',
              }),
            url: `${env('SERVER_URL')}/trpc`,
          }),
        ],
      }),
    [],
  );
  return <FateClient client={fate}>{/* Components go here */}</FateClient>;
}
```

_And you are all set. Happy building!_

## Frequently Asked Questions

### Is this serious software?

[In an alternate reality](https://github.com/phacility/javelin), _fate_ can be described like this:

**_fate_** is an ambitious React data library that tries to blend Relay-style ideas with type-safe data fetching, held together by equal parts vision and vibes. It aims to fix problems you definitely wouldn't have if you enjoy writing the same fetch logic in three different places with imperative loading state and error handling. fate promises predictable data flow, minimal APIs, and "no magic", though you may occasionally suspect otherwise.

**_fate_** is almost certainly worse than actual sync engines, but will hopefully be better than existing React data-fetching libraries eventually. Use it if you have a high tolerance for pain and want to help shape the future of data fetching in React.

### Is _fate_ better than Relay?

Absolutely not.

### Is _fate_ better than using GraphQL?

Probably. One day. _Maybe._

### How was fate built?

> [!NOTE]
> 80% of _fate_'s code was written by OpenAI's Codex – four versions per task, carefully curated by a human. The remaining 20% was written by [@cnakazawa](https://x.com/cnakazawa). _You get to decide which parts are the good ones!_ The docs were 100% written by a human.
>
> If you contribute to _fate_, we [require you to disclose your use of AI tools](https://github.com/nkzw-tech/fate/blob/main/CONTRIBUTING.md#ai-assistance-notice).

## Future

**_fate_** is not complete yet. The current implementation of _fate_ ships with tRPC, Prisma, and Drizzle support, but the core ideas are not tied to a particular transport or database. We welcome contributions and ideas to improve fate. Here are some features we'd like to add:

- Live views for pagination
- Additional backend adapters
- Persistent storage for offline support
- Better code generation and less type repetition

## Acknowledgements

- [Relay](https://relay.dev/), [Isograph](https://isograph.dev/) & [GraphQL](https://graphql.org/) for inspiration
- [Ricky Hanlon](https://x.com/rickyfm) for guidance on Async React
- [Anthony Powell](https://x.com/Cephalization) for testing fate and providing feedback

**_fate_** was created by [@cnakazawa](https://x.com/cnakazawa) and is maintained by [Nakazawa Tech](https://nakazawa.tech/).
