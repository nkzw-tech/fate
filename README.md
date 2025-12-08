<!-- auto-generated from docs/guide/*.md. Do not edit directly. -->

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="/public/fate-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="/public/fate-logo.svg">
    <img alt="Logo" src="/public/fate-logo.svg" width="50%">
  </picture>
</p>

**_fate_** is a modern data client for React and tRPC inspired by [Relay](https://relay.dev/) and [GraphQL](https://graphql.org/). It combines view composition, normalized caching, data masking, Async React features, and tRPC's type safety.

### Features

- **View Composition:** Components declare their data requirements using co-located "views". Views are composed into a single request per screen, minimizing network requests and eliminating waterfalls.
- **Normalized Cache:** fate maintains a normalized cache for all fetched data. This enables efficient data updates through actions and mutations and avoids stale or duplicated data.
- **Data Masking & Strict Selection:** fate enforces strict data selection for each view, and masks (hides) data that components did not request. This prevents accidental coupling between components and reduces overfetching.
- **Async React:** fate uses modern Async React features like Actions, Suspense, and `use` to support concurrent rendering and enable a seamless user experience.
- **Lists & Pagination:** fate provides built-in support for connection-style lists with cursor-based pagination, making it easy to implement infinite scrolling and "load-more" functionality.
- **Optimistic Updates:** fate supports declarative optimistic updates for mutations, allowing the UI to update immediately while the server request is in-flight. If the request fails, the cache and its associated views are rolled back to their previous state.
- **AI-Ready:** fate's minimal, predictable API and explicit data selection enable local reasoning, allowing AI tools to generate stable, type-safe data-fetching code.

### A modern data client for React & tRPC

**_fate_** is designed to make data fetching and state management in React applications more composable, declarative, and predictable. The framework has a minimal API, no DSL, and no magic—_it's just JavaScript_.

GraphQL and Relay introduced several novel ideas: fragments co‑located with components, [a normalized cache](https://relay.dev/docs/principles-and-architecture/thinking-in-graphql/#caching-a-graph) keyed by global identifiers, and a compiler that hoists fragments into a single network request. These innovations made it possible to build large applications where data requirements are modular and self‑contained.

[Nakazawa Tech](https://nakazawa.tech) builds apps and [games](https://athenacrisis.com) primarily with GraphQL and Relay. We advocate for these technologies in [talks](https://www.youtube.com/watch?v=rxPTEko8J7c&t=36s) and provide templates ([server](https://github.com/nkzw-tech/server-template), [client](https://github.com/nkzw-tech/web-app-template/tree/with-relay)) to help developers get started quickly.

However, GraphQL comes with its own type system and query language. If you are already using tRPC or another type‑safe RPC framework, it's a significant investment to adopt and implement GraphQL on the backend. This investment often prevents teams from adopting Relay on the frontend.

Many React data frameworks lack Relay's ergonomics, especially fragment composition, co-located data requirements, predictable caching, and deep integration with modern React features. Optimistic updates usually require manually managing keys and imperative data updates, which is error-prone and tedious.

fate takes the great ideas from Relay and puts them on top of tRPC. You get the best of both worlds: type safety between the client and server, and GraphQL-like ergonomics for data fetching. Using _fate_ usually looks like this:

```tsx
export const PostView = view<Post>()({
  content: true,
  id: true,
  title: true,
  author: UserView,
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

_[Learn more](/docs/guide/getting-started.md) about fate's core concepts or get started with [a ready-made template](https://github.com/nkzw-tech/fate-template#readme)._

## Getting Started

### Template

Get started with [a ready-made template](https://github.com/nkzw-tech/fate-template#readme) quickly:

::: code-group

```npm
npx giget@latest gh:nkzw-tech/fate-template
```

```pnpm
pnpx giget@latest gh:nkzw-tech/fate-template
```

```yarn
yarn dlx giget@latest gh:nkzw-tech/fate-template
```

:::

`fate-template` comes with a simple tRPC backend and a React frontend using **_fate_**. It features modern tools to deliver an incredibly fast development experience. Follow its [README.md](https://github.com/nkzw-tech/fate-template#fate-quick-start-template) to get started.

### Manual Installation

**_fate_** requires React 19.2+. For your client you need to install `react-fate`:

::: code-group

```npm
npm add react-fate
```

```pnpm
pnpm add react-fate
```

```yarn
yarn add react-fate
```

:::

And for your server, install the core `@nkzw/fate` package:

::: code-group

```npm
npm add @nkzw/fate
```

```pnpm
pnpm add @nkzw/fate
```

```yarn
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
  const { posts } = useRequest({
    posts: { list: PostView, type: 'Post' },
  } as const);

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
import type { Post, User } from '@your-org/server/trpc/views';
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
  const { posts } = useRequest({
    posts: { list: PostView, type: 'Post' },
  } as const);

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
> `useRequest` might issue multiple requests which are automatically batched together by tRPC's [HTTP Batch Link](https://trpc.io/docs/client/links/httpBatchLink) into a single network request.

### Requesting Objects by ID

If you want to fetch data for a single object instead of a list, you can specify the `id` and the associated `view` like this:

```tsx
const { post } = useRequest({
  post: { id: '12', type: 'Post', view: PostView } as const,
});
```

If you want to fetch multiple objects by their IDs, you can use the `ids` field:

```tsx
const { posts } = useRequest({
  posts: { ids: ['6', '7'], type: 'Post', view: PostView } as const,
});
```

### Other Types of Requests

For any other queries, pass only the `type` and `view`:

```tsx
const { viewer } = useRequest({
  viewer: { type: 'User', view: UserView } as const,
});
```

### Request Arguments

You can pass arguments to `useRequest` calls. This is useful for pagination, filtering, or sorting. For example, to fetch the first 10 posts, you can do the following:

```tsx
const { posts } = useRequest({
  posts: {
    args: { first: 10 },
    list: PostView,
    type: 'Post',
  },
});
```

### Request Modes

`useRequest` supports different request modes to control caching and data freshness. The available modes are:

- `cache-first` (_default_): Returns data from the cache if available, otherwise fetches from the network.
- `stale-while-revalidate`: Returns data from the cache and simultaneously fetches fresh data from the network.
- `network-only`: Always fetches data from the network, bypassing the cache.

You can pass the request mode as an option to `useRequest`:

```tsx
const { posts } = useRequest(
  { posts: { list: PostView, type: 'Post' } } as const,
  {
    mode: 'stale-while-revalidate',
  },
);
```

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
} as const;

const PostView = view<Post>()({
  comments: CommentConnectionView,
});
```

Now you can apply the `useListView` hook inside of your `PostCard` component to read the list of comments and load more comments when needed:

```tsx
export function PostCard({
  detail,
  post: postRef,
}: {
  detail?: boolean;
  post: ViewRef<'Post'>;
}) {
  const post = useView(PostView, postRef);
  const [comments, loadNext] = useListView(
    CommentConnectionView,
    post.comments,
  );

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

## Actions

fate does not provide hooks for mutations like traditional data fetching libraries do. Instead, mutations are exposed in two ways:

- `fate.actions` for use with [`useActionState`](https://react.dev/reference/react/useActionState) and React Actions.
- `fate.mutations` for traditional imperative mutation calls.

Mutations in your tRPC backend are made available as actions and mutations by fate's generated client.

Let's assume that our `Post` entity has a tRPC mutation for liking a post called `post.like`. A `LikeButton` component using fate Actions and an async component library could then look like this:

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
  const [result, like, isPending] = useActionState(
    fate.actions.post.like,
    null,
  );

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

fate Actions & Mutations are backed by regular tRPC mutations on the server. Here is an example implementation of the `like` mutation in the `postRouter`.

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

See the [Server Integration](#server-integration) section for more details on how to integrate tRPC routers with fate.

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
    const timeout = setTimeout(
      () => startTransition(() => like('reset')),
      3000,
    );
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

## Server Integration

Until now, we have focused on the client-side API of fate. You'll need a tRPC backend that follows some conventions so you can generate a typed client using fate's CLI. At the moment _fate_ is designed to work with tRPC and Prisma, but the framework is not coupled to any particular ORM or database, it's just what we are starting with.

### Conventions & Object Identity

fate expects that data is served by a tRPC backend that follows these conventions:

- A `byId` query for each data type to fetch individual objects by their unique identifier (`id`).
- A `list` query for fetching lists of objects with support for pagination.

Objects are identified by their ID and type name (`__typename`, e.g. `Post`, `User`), and stored by `__typename:id` (e.g. "Post:123") in the client cache. fate keeps list orderings under stable keys derived from the backend procedure and args. Relations are stored as IDs and returned to components as ViewRef tokens.

fate's type definitions might seem verbose at first glance. However, with fate's minimal API surface, AI tools can easily generate this code for you. For example, fate has a minimal CLI that generates types for the client, but you can also let your LLM write it by hand if you prefer.

> [!NOTE]
> You can adopt _fate_ incrementally in an existing tRPC codebase without changing your existing schema by adding these queries alongside your existing procedures.

### Data Views

To continue with our client example, let's assume we have a `post.ts` file with a tRPC router that exposes a `byId` query for selecting objects by id, and a root `list` query to fetch a list of posts.

Since clients can send arbitrary selection objects to the server, we need to implement a way to translate these selection objects into database queries without exposing raw database queries and private data to the client. On the client, we define views to select fields on each type. We can do the same on the server using fate data views and the `dataView` function from `@nkzw/fate/server`.

Create a `views.ts` file next to your root tRPC router that exports the data views for each type. Here is how you can define a `User` data view for Prisma's `User` model:

```tsx
import { dataView, type Entity } from '@nkzw/fate/server';
import type { User as PrismaUser } from '../prisma/prisma-client/client.ts';

export const userDataView = dataView<PrismaUser>('User')({
  id: true,
  name: true,
  username: true,
});

export type User = Entity<typeof userDataView, 'User'>;
```

_Note: Currently, fate provides helpers to integrate with Prisma, but the framework is not coupled to any particular ORM or database. We hope to provide more direct integrations in the future, and are always open to contributions._

### tRPC Router Implementation

We can apply the above data view in our tRPC router and resolve the client's selection against it using `createResolver`. Here is an example implementation of the `byId` query for the `User` type which allows fetching multiple users by `id`:

```tsx
import { byIdInput, createResolver } from '@nkzw/fate/server';
import { z } from 'zod';
import type { UserFindManyArgs } from '../../prisma/prisma-client/models.ts';
import { procedure, router } from '../init.ts';
import { userDataView } from '../views.ts';

export const userRouter = router({
  byId: procedure.input(byIdInput).query(async ({ ctx, input }) => {
    const { resolveMany, select } = createResolver({
      ...input,
      ctx,
      view: userDataView,
    });

    const users = await ctx.prisma.user.findMany({
      select: select,
      where: { id: { in: input.ids } },
    } as UserFindManyArgs);

    return await resolveMany(users);
  }),
});
```

Now that we apply `userDataView` to the `byId` query, the server limits the selection to the fields defined in the data view, keeping private fields hidden from the client, and providing type safety for client views:

```tsx
const UserData = view<User>()({
  // Type-error + ignored during runtime.
  password: true,
});
```

### tRPC List Implementation

To implement the `list` query for fetching a paginated list of posts, we can use fate's `createConnectionProcedure` helper. This helper simplifies the implementation of pagination. Here is an example implementation of the `postRouter` with a `list` query:

```tsx
import { createResolver } from '@nkzw/fate/server';
import type { PostFindManyArgs } from '../../prisma/prisma-client/models.ts';
import { createConnectionProcedure } from '../connection.ts';
import { router } from '../init.ts';
import { postDataView } from '../views.ts';

export const postRouter = router({
  list: createConnectionProcedure({
    query: async ({ ctx, cursor, direction, input, skip, take }) => {
      const { resolveMany, select } = createResolver({
        ...input,
        ctx,
        view: postDataView,
      });
      const findOptions: PostFindManyArgs = {
        orderBy: { createdAt: 'desc' },
        select,
        take: direction === 'forward' ? take : -take,
      };

      if (cursor) {
        findOptions.cursor = { id: cursor };
        findOptions.skip = skip;
      }

      const items = await ctx.prisma.post.findMany(findOptions);
      return resolveMany(direction === 'forward' ? items : items.reverse());
    },
  }),
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
} as const;
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
  comments: list(commentDataView),
});
```

We can define extra root-level lists and queries by exporting a `Root` object from our `views.ts` file using the same view syntax as everywhere else:

```tsx
export const Root = {
  categories: list(categoryDataView),
  commentSearch: { procedure: 'search', view: list(commentDataView) },
  events: list(eventDataView),
  posts: list(postDataView),
  viewer: userDataView,
};
```

Entries that wrap their view in `list(...)` are treated as list resolvers and use the `procedure` name when calling the corresponding router procedure, defaulting to `list`. If you omit `list(...)`, fate treats the entry as a standard query and uses the view type name to infer the router name.

For the above `Root` definitions, you can make the following requests using `useRequest`:

```tsx
const query = 'Apple';

const { posts, categories, viewer } = useRequest({
  // Explicit Root queries:
  categories: { list: categoryView, type: 'Category' },
  commentSearch: { args: { query }, list: commentView, type: 'Comment' },
  events: { list: eventView, type: 'Event' },
  posts: { list: postView, type: 'Post' },
  viewer: { type: 'User', view: userView },

  // Queries by id, if those entities have a `byId` query defined:
  post: { id: '12', type: 'Post', view: postView },
  comment: { ids: ['6', '7'], type: 'Comment', view: commentView },
} as const);
```

### Data View Resolvers

fate data views support resolvers for computed fields. If we want to add a `commentCount` field to our `Post` data view, we can use the `resolver` helper that defines a Prisma selection for the database query together with a `resolve` function:

```tsx
export const postDataView = dataView<PostItem>('Post')({
  author: userDataView,
  commentCount: resolver<PostItem, number>({
    resolve: ({ _count }) => _count?.comments ?? 0,
    select: () => ({
      _count: { select: { comments: true } },
    }),
  }),
  comments: list(commentDataView),
  id: true,
});
```

This definition makes the `commentCount` field available to your client-side views.

### Authorization in Resolvers

You might want to restrict access to certain fields based on the current user or other contextual information. You can do this by adding an `authorize` function to your resolver definition:

```tsx
export const userDataView = dataView<UserItem>('User')({
  email: resolver<UserItem, string | null, { sessionUser: string }>({
    authorize: ({ id }, context) => context?.sessionUserId === id,
    resolve: ({ email }) => email,
  }),
  id: true,
});
```

### Generating a typed client

Now that we have defined our client views and our tRPC server, we need to connect them with some glue code. We recommend using fate's CLI for convenience.

First, make sure our tRPC `router.ts` file exports the `appRouter` object, `AppRouter` type and all the views we have defined:

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

_Note: We try to keep magic to a minimum and you can handwrite the [generated client](https://github.com/nkzw-tech/fate/blob/main/example/client/src/fate.ts) if you prefer._

```bash
pnpm fate generate @your-org/server/trpc/router.ts client/src/fate.ts
```

_Note: fate uses the specified server module name to extract the server types it needs and uses the same module name to import the views into the generated client. Make sure that the module is available both at the root where you are running the CLI and in the client package._

### Creating a _fate_ Client

Now that we have generated the client types, all that remains is creating an instance of the fate client, and using it in our React app using the `FateClient` context provider:

```tsx
import { httpBatchLink } from '@trpc/client';
import { FateClient } from 'react-fate';
import { createFateClient } from './fate.ts';

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

**_fate_** is an ambitious React data library that tries to blend Relay-style ideas with tRPC, held together by equal parts vision and vibes. It aims to fix problems you definitely wouldn't have if you enjoy writing the same fetch logic in three different places with imperative loading state and error handling. fate promises predictable data flow, minimal APIs, and "no magic", though you may occasionally suspect otherwise.

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

**_fate_** is not complete yet. It lacks core features such as garbage collection, a compiler to extract view definitions statically and ahead of time, and there is too much backend boilerplate. The current implementation of _fate_ is not tied to tRPC or Prisma, those are just the ones we are starting with. We welcome contributions and ideas to improve fate. Here are some features we'd like to add:

- Support for Drizzle
- Support backends other than tRPC
- Better code generation and less type repetition
- Support for live views and real-time updates via `useLiveView` and SSE
- Implement garbage collection for the cache
- Add persistent storage for offline support

## Acknowledgements

- [Relay](https://relay.dev/), [Isograph](https://isograph.dev/) & [GraphQL](https://graphql.org/) for inspiration
- [Ricky Hanlon](https://x.com/rickyfm) for guidance on Async React
- [Anthony Powell](https://x.com/Cephalization) for testing fate and providing feedback

**_fate_** was created by [@cnakazawa](https://x.com/cnakazawa) and is maintained by [Nakazawa Tech](https://nakazawa.tech/).
