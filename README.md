# fate

**fate** is a modern data client for tRPC and React inspired by [Relay](https://relay.dev/) and [GraphQL](https://graphql.org/). It combines view composition, normalized caching, data masking, Async React features, and tRPC’s type safety.

**fate** is designed to make data fetching and state management in React applications more composable, declarative, and predictable. The framework has a minimal API, no DSL, and no magic—_it's just JavaScript_.

### Features

- **View Composition:** Components declare their data requirements using co-located "views". Views are composed into a single request per screen, minimizing network requests and eliminating waterfalls.
- **Normalized Cache:** fate maintains a normalized cache for all fetched data in your application. This enables efficient data updates through actions or mutations and avoids stale or duplicated data.
- **Data Masking & Strict Selection:** fate enforces strict data selection for each view, and masks (hides) data that components did not request. This prevents accidental coupling between components and reduces overfetching.
- **Async React:** fate uses modern Async React features like Actions, Suspense, and `use` to support concurrent rendering and enable a seamless user experience.
- **Lists & Pagination:** fate provides built-in support for connection-style lists with cursor-based pagination, making it easy to implement infinite scrolling and "load-more" functionality.
- **Optimistic Updates:** fate supports declarative optimistic updates for mutations, allowing the UI to update immediately while the server request is in-flight. If the request fails, the cache and its associated views are rolled back to their previous state.
- **AI Ready:** fate’s minimal, predictable API and explicit data selection allow for clear local reasoning, enabling AI tools to generate stable, type-safe data-fetching code.

### Why fate?

GraphQL and Relay introduced several novel ideas: fragments co‑located with components, a normalized cache keyed by global identifiers, and a compiler that hoists fragments into a single network request. These innovations made it possible to build large applications where data requirements are modular and self‑contained.

Nakazawa Tech builds apps primarily with GraphQL and Relay. We advocate for these technologies in [talks](https://www.youtube.com/watch?v=rxPTEko8J7c&t=36s) and provide templates ([server](https://github.com/nkzw-tech/server-template), [client](https://github.com/nkzw-tech/web-app-template/tree/with-relay)) to help developers get started quickly.

However, GraphQL comes with its own type system and query language. If you are already using tRPC or another type‑safe RPC framework, it's a significant investment to adopt and implement GraphQL on the backend. This investment often prevents teams from adopting Relay on the frontend. Many other React data frameworks lack the ergonomics of Relay, especially fragment composition, co-located data requirements, predictable caching, and deep integration with modern React features. Optimistic updates usually require manually managing keys and imperative data updates, which is error-prone and tedious.

fate takes the great ideas from Relay and puts them on top of tRPC. You get the best of both worlds: type safety between the client and server, and GraphQL-like ergonomics for data fetching.

## Installation

**fate** requires React 19.2+.

```bash
pnpm add react-fate @nkzw/fate
```

_Note: **fate** is currently in alpha and not production ready. If something doesn't work for you, send a Pull Request._

## Core Concepts

**fate** has a minimal API surface and is aimed at reducing data fetching complexity.

### Thinking in Views

With fate, each component declares the data it needs using views, and you compose your UI until the point where the closest request is made. Data fetching then happens automatically. Loading states are handled through React Suspense, and data fetching errors bubble up to the nearest React error boundaries.

You no longer need to worry about _when_ to fetch data, how to coordinate loading states for individual requests, or how to manage errors imperatively. With fate, you avoid overfetching, prevent passing unnecessary data down the component tree, and eliminate the need to manually define types just to select a subset of data for a child component.

### Views

#### Defining Views

Let's start by defining a simple view for a blog's `Post` component. fate requires you to explicitly "select" each field that you are going to use in your components. Here is how you can define a view for a `Post` entity that has `title` and `content` fields:

```tsx
import type { Post } from '@your-org/server/trpc/views.ts';
import { view } from 'react-fate';

export const PostView = view<Post>()({
  title: true,
  content: true,
});
```

#### Resolving a View with `useView`

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

A `ViewRef` is a reference to an object of a specific type, in this case a `Post`. It contains the unique ID for the object, the type name (as `__typename`) and some fate-specific metadata. fate creates and manages these references for you, and you can pass them around your components as needed.

When you use `useView`, fate automatically subscribes to changes for the selected fields in the view. If the data for a specific `Post` changes (e.g. the `title` or `content` is updated), all components that rely on that data will re-render automatically.

#### Fetching Data with `useRequest`

Now that we defined our view and component, we fetch the data from the server using the `useRequest` hook from fate. This hook allows us to declare what data we need for a specific screen or component tree. At the root of our `HomePage` component, we can request a list of posts like this:

```tsx
import { useRequest } from 'react-fate';
import { PostCard, PostView } from './PostCard.tsx';

export function HomePage() {
  const { posts } = useRequest({
    posts: { root: PostView, type: 'Post' },
  } as const);

  return posts.map((post) => <PostCard key={post.id} post={post} />);
}
```

This component will automatically suspend or throw errors that bubble to the nearest error boundary. For example, you can wrap your component tree with a `Suspense` component to show a loading state while the data is being fetched:

```tsx
<ErrorBoundary FallbackComponent={ErrorComponent}>
  <Suspense fallback={<div>Loading…</div>}>
    <HomePage />
  </Suspense>
</ErrorBoundary>
```

#### Composing Views

In the above example we are defining a single view for a `Post`. One of fate's core strengths is view composition. Let's say we want to show the author's name along with the post. A simple way to do this is by adding an `author` field to the `PostView` with a concrete selection:

```tsx
import { Suspense } from 'react';
import { useRequest, useView, ViewRef } from 'react-fate';

export const PostView = view<Post>()({
  author: {
    id: true,
    name: true,
  },
  title: true,
  content: true,
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

This fetches the author associated with the Post and makes it available to the `PostCard` component. However, this approach has some downsides:

1. The `author` selection is tightly coupled to the `PostView`. If we want to use the author's data in another component, we would need to duplicate the field selection.
1. If the `author` has more fields that we want to use in other components, we would have to add them to the `PostView`, leading to overfetching.
1. We cannot reuse the `author` field selection in other views or components.

In fate, views are composable and reusable. Instead of inlining the selection, we can define a `UserView` and compose it into the `PostView` like this:

```tsx
import type { Post, User } from '@your-org/server/trpc/views';
import { view } from 'react-fate';

export const UserView = view<User>()({
  profilePicture: true,
  id: true,
  name: true,
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

export const UserCard = ({
  author: authorRef,
}: {
  author: ViewRef<'User'>;
}) => {
  const author = useView(UserView, authorRef);

  return (
    <div>
      <img src={author.profilePicture} alt={author.name} />
      <p>{author.name}</p>
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
      <UserCard author={post.author} />
      <p>{post.content}</p>
    </Card>
  );
};
```

#### View Spreads

When you are building complex UIs, you will often build multiple components that share the same data requirements. In fate, you can use view spreads to compose such views together. This is similar to GraphQL fragment spreads, but works with plain JavaScript objects.

Let's assume we want to fetch and display additional information about the author in the `PostCard`, such as their bio. We can simply select the `bio` field for use in our `PostCard` component:

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
  postCount: true,
  followerCount: true,
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

#### useListView

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

#### Suspending through `useView`

While `useRequest` is responsible for fetching data from the server and `useView` is used for reading data from the cache based on a selection, there are cases where `useView` might need to fetch additional data that is not yet available in the cache. In such cases, `useView` will suspend the component and fetch only the missing data automatically.

#### Type Safety and Data Masking

fate provides guarantees through TypeScript and during runtime that prevent you from accessing data that wasn't selected. If you forget to select the `content` of a `Post`, type-checks will fail for the `content` field and it will be undefined during runtime:

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

### Actions

fate does not provide hooks for mutations like traditional data fetching libraries do. Instead, mutations are exposed in two ways:

- `fate.actions` for use with [`useActionState`](https://react.dev/reference/react/useActionState) and React Actions.
- `fate.mutations` for traditional imperative mutation calls.

Mutations in your tRPC backend will be made available automatically as actions and mutations by fate's generated client.

Let's assume that our `Post` entity has a tRPC mutation for liking a post called `post.like`. A `LikeButton` component using fate Actions and an async component library could then look like this:

```tsx
const LikeButton = ({ post }: { post: { id: string; likes: number } }) => {
  const [likeResult, likeAction] = useActionState(fate.actions.post.like, null);

  return (
    <Button action={() => likeAction({ input: { id: post.id } })}>
      {likeResult?.error ? 'Oops!' : 'Like'}
    </Button>
  );
};
```

If you are not using an async component library, you can use React's `useTransition` to start the action in a transition:

```tsx
const LikeButton = ({ post }: { post: { id: string; likes: number } }) => {
  const [, startTransition] = useTransition();
  const [likeResult, likeAction, likeIsPending] = useActionState(
    fate.actions.post.like,
    null,
  );

  return (
    <button
      disabled={likeIsPending}
      onClick={() => {
        startTransition(() =>
          likeAction({
            input: { id: post.id },
          }),
        );
      }}
    >
      {likeResult?.error ? 'Oops!' : 'Like'}
    </button>
  );
};
```

By using `useActionState`, fate Actions automatically integrate with Suspense and concurrent rendering.

#### Optimistic Updates

fate Actions support optimistic updates out of the box. For example, to update the post's like count optimistically, you can pass an `optimisticUpdate` object to the action call. This will immediately update the cache with the new like count and re-render all views that select the `likes` field:

```tsx
likeAction({
  input: { id: post.id },
  optimisticUpdate: { likes: post.likes + 1 },
});
```

If the mutation fails, the cache will be rolled back to its previous state automatically and any views depending on the mutated data will be updated.

When a mutation inserts a new object, you can provide an optimistic object with a temporary ID to represent the new object in the cache until the server responds with the actual ID. For example, to add a new comment to a post optimistically, you can do the following:

```tsx
const content = 'New Comment text';
addComment({
  input: { content, postId: post.id },
  optimisticUpdate: {
    author: { id: user.id, name: user.name },
    content,
    id: `optimistic:${Date.now().toString(36)}`,
    post: { commentCount: post.commentCount + 1, id: post.id },
  },
});
```

#### Selecting a View with Actions

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

The server will return the selected fields and fate updates the cache and re-renders all views that depend on the changed data automatically. The action result will contain the newly added comment with the selected fields:

```tsx
const [addCommentResult, addComment] = useActionState(
  fate.actions.comment.add,
  null,
);

const newComment = addCommentResult?.result;
if (newComment) {
  // All the fields selected in the view are available on `newComment`:
  console.log(newComment.post.commentCount);
}
```

#### Mutations

`useActionState` runs actions in a queue. This means only one action runs at a time, and subsequent actions have to wait for the previous one to finish. Sometimes you might want to run mutations immediately without waiting. For such cases, you can use `fate.mutations` to call mutations imperatively:

```tsx
const result = await fate.mutations.comment.add({
  input: { content, postId: post.id },
});
```

#### Mutation Server Implementation

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

      const updated = await ctx.prisma.post.update({
        data: {
          likes: {
            increment: 1,
          },
        },
        select,
        where: { id: input.id },
      });
      return resolve(updated as unknown as PostItem);
    }),
});
```

See the [Server Integration](#server-integration) section for more details on how to integrate tRPC routers with fate.

#### Action & Mutation Error Handling

fate Actions & Mutations separate error handling into two scopes: "call site" and "boundary". Call site errors are errors that are expected to be handled at the location where the action or mutation is called. Boundary errors are unexpected errors that should be handled by a higher-level error boundary.

If your server returns a `NOT_FOUND` with code `404`, the result of an Action or Mutation will contain an error object that you can handle at the call site:

```tsx
const [result] = useActionState(fate.actions.post.delete, null);
if (result?.error) {
  if (result.error.code === 'NOT_FOUND') {
    // Handle not found error at call site
  } else {
    // Handle other expected errors
  }
}
```

However, if an `INTERNAL_SERVER_ERROR` with code `500` occurs, the error will be thrown and can be caught by the nearest React error boundary:

```tsx
<ErrorBoundary FallbackComponent={ErrorComponent}>
  <Suspense fallback={<div>Loading…</div>}>
    <PostPage postId={postId} />
  </Suspense>
</ErrorBoundary>
```

You can find the error classification behavior in [`mutation.ts`](https://github.com/nkzw-tech/fate/blob/main/packages/fate/src/mutation.ts#L227-L254).

## Server Integration

Until now, we have focused on the client-side API of fate. You'll need a tRPC backend that follows some conventions so you can generate a typed client using fate's CLI. To continue with our client example, let's assume you have a `post.ts` file with a tRPC router that exposes a `byId` query for selecting objects by id, and a root `list` query to fetch a list of posts.

### Conventions & Object Identity

fate expects that data is served by a tRPC backend that follows these conventions:

- A `byId` query for each data type to fetch individual objects by their unique identifier (`id`).
- A `list` query for fetching lists of objects with support for pagination.

Objects are identified by their ID and a type name (`__typename`, e.g. `Post`, `User`), and stored by `__typename:id` (e.g. "Post:123") in the client cache. fate keeps list orderings under stable keys derived from the backend procedure and args. Relations are stored as IDs and returned to components as ViewRef tokens.

fate's type definitions might feel verbose at first glance. However, with fate's minimal API surface, AI tools can easily generate this code for you. For example, fate has a minimal CLI that generates types for the client, but you can also let your LLM write it by hand if you prefer.

### Data Views

Since clients can send arbitrary selection objects to the server, we need to implement a way to translate these selection objects into database queries without exposing raw database queries and private data to the client.
On the client, we define views to select fields on each type. We can do the same on the server using fate data views and the `dataView` function from `@nkzw/fate/server`.

Create a `views.ts` file next to your root tRPC router that exports the data views for each type. Here is how you can define a `User` data view for Prisma's `User` model:

```tsx
import { dataView, DataViewResult } from '@nkzw/fate/server';
import type { User as PrismaUser } from '../prisma/prisma-client/client.ts';

export const userDataView = dataView<PrismaUser>('User')({
  id: true,
  name: true,
  username: true,
});

export type User = DataViewResult<typeof userDataView> & {
  __typename: 'User';
};
```

_Note: Currently, fate provides helpers to integrate with Prisma, but the framework is not coupled to any particular ORM or database. We hope to provide more direct integrations in the future, and are always open to contributions._

### tRPC Router Implementation

We can apply the above data view in our tRPC router and resolve the client's selection against it using `createResolver`. Here is an example implementation of the `byId` query for the `User` type which allows fetching multiple users by `id`:

```tsx
import { connectionArgs, createResolver } from '@nkzw/fate/server';
import { z } from 'zod';
import type { UserFindManyArgs } from '../../prisma/prisma-client/models.ts';
import { procedure, router } from '../init.ts';
import { userDataView } from '../views.ts';

export const userRouter = router({
  byId: procedure
    .input(
      z.object({
        args: connectionArgs,
        ids: z.array(z.string().min(1)).nonempty(),
        select: z.array(z.string()),
      }),
    )
    .query(async ({ ctx, input }) => {
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
  id: true,
  title: true,
  content: true,
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

We can also define root-level lists by exporting a `Lists` object from our `views.ts` file:

```tsx
export const Lists = {
  posts: postDataView,
};
```

This makes it possible to fetch a list of posts from the client using `useRequest`.

### Data View Resolvers

fate data views support resolvers for computed fields. If we want to add a `commentCount` field to our `Post` data view, we can use the `resolver` helper that defines a Prisma selection for the database query together with a `resolve` function:

```tsx
export const postDataView = dataView<PostItem>('Post')({
  author: userDataView,
  commentCount: resolver<PostItem>({
    resolve: ({ item }) => item._count?.comments ?? 0,
    select: () => ({
      _count: { select: { comments: true } },
    }),
  }),
  comments: list(commentDataView),
  id: true,
} as const;
```

This definition makes the `commentCount` field available to your client-side views.

### Generating a typed client

Now that we have defined our client views and our tRPC server, we need to connect them with some glue code. We recommend using fate's CLI for convenience.

First, make sure your tRPC `router.ts` file exports the `appRouter` object, `AppRouter` type and all the views you have defined:

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

_Note: We try to keep magic to a minimum and you can handwrite the [generated client](https://github.com/nkzw-tech/fate/blob/main/example/client/src/lib/fate.generated.ts) if you prefer._

```bash
pnpm fate generate @your-org/server/trpc/router.ts client/src/lib/fate.generated.ts
```

_Note: fate uses the specified server module name to extract the server types it needs and uses the same module name to import the views into the generated client. Make sure that the module is available both at the root where you are running the CLI and in the client package._

### Creating a fate Client

Now that we have generated the client types, all that remains is creating the instance of the fate client, and using it in our React app using the `FateClient` context provider.

Create a `fate.ts` file:

```tsx
import { createFateClient } from './lib/fate.generated';

export const fate = createFateClient({
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
});
```

And now wrap your app with the `FateClient` provider:

```tsx
import { FateClient } from 'react-fate';
import { fate } from './fate.ts';

export function App() {
  return <FateClient client={fate}>{/* Components go here */}</FateClient>;
}
```

_And you are all set. Happy building!_

## Advanced Features

### Request Arguments

You can pass arguments to your `useRequest` calls. This is useful for pagination, filtering, or sorting. For example, to fetch the first 10 posts, you can do the following:

```tsx
const { posts } = useRequest({
  posts: {
    args: { first: 10 },
    root: PostView,
    type: 'Post',
  },
});
```

### Request Modes

`useRequest` supports different request modes to control caching and data freshness. The available modes are:

- `cache-or-network` (_default_): Returns data from the cache if available, otherwise fetches from the network.
- `cache-and-network`: Returns data from the cache and simultaneously fetches fresh data from the network.
- `network-only`: Always fetches data from the network, bypassing the cache.

You can pass the request mode as an option to `useRequest`:

```tsx
const { posts } = useRequest(
  {
    posts: { root: PostView, type: 'Post' },
  },
  { mode: 'cache-and-network' },
);
```

### Custom Root Lists

We previously mentioned that you can define root lists by exporting a `Lists` object from your `views.ts` file. However, sometimes you might want to define custom root lists that don't directly map to a single data view. For example, you might want to expose a search endpoint that returns a list of posts based on a search query:

```tsx
export const Lists = {
  // …
  postSearch: { procedure: 'search', view: postDataView },
  // …
};
```

This maps the `postSearch` list to a `search` procedure on your post router.

### Resetting Action State

When you are using `useActionState`, the result of the action is cached until the component using the action is unmounted. When a mutation fails with an error, you might want to clear the error state without invoking the action again. fate Actions take a `'reset'` token to reset the action state:

```tsx
const [likeResult, likeAction] = useActionState(fate.actions.post.like, null);

useEffect(() => {
  if (likeResult?.error) {
    // Reset the action state after 3 seconds.
    const timeout = setTimeout(() => likeAction('reset'), 3000);
    return () => clearTimeout(timeout);
  }
}, [likeAction, likeResult]);
```

## Acknowledgements

- [Relay](https://relay.dev/) & [GraphQL](https://graphql.org/) for inspiration
- [Rick Hanlon](https://x.com/rickyfm) for guidance on Async React

## Is this serious software?

**fate** is an ambitious React data library that tries to blend Relay-style ideas with tRPC, held together by equal parts vision and vibes. It aims to fix problems you definitely wouldn't have if you enjoy writing the same fetch logic in three different places with imperative loading state and error handling. fate promises predictable data flow, minimal APIs, and “no magic,” though you may occasionally suspect otherwise.

80% of the code was written by Codex – four versions per task, carefully curated by a human. The remaining 20% was written by [@cpojer](https://x.com/cnakazawa). You get to decide which parts are the good ones. The README was 100% written by a human. _Maybe._

**fate** is almost certainly worse than actual sync engines, but it will eventually be way better than every other existing React data-fetching library. Use it if you have a high tolerance for pain and want to help shape the future of data fetching in React.

### Is fate better than Relay?

Absolutely not.

### Is fate better than using GraphQL?

Probably. One day. _Maybe._

## Future

We welcome contributions and ideas to improve fate. Here are some features we are considering for future releases:

- Support for Drizzle.
- Support backends other than tRPC.
- Better code generation and less type repetition.
- Better server integration for nested connections.
- Support for live views (subscriptions) and real-time updates via `useLiveView` and SSE.
- Implement garbage collection for the cache.
- Add persistent storage for offline support.
