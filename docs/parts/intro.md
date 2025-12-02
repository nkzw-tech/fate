<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="/public/fate-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="/public/fate-logo.svg">
    <img alt="Logo" src="/public/fate-logo.svg" width="50%">
  </picture>
</p>

**_fate_** is a modern data client for React and tRPC inspired by [Relay](https://relay.dev/) and [GraphQL](https://graphql.org/). It combines view composition, normalized caching, data masking, Async React features, and tRPC's type safety.

## Features

- **View Composition:** Components declare their data requirements using co-located "views". Views are composed into a single request per screen, minimizing network requests and eliminating waterfalls.
- **Normalized Cache:** fate maintains a normalized cache for all fetched data. This enables efficient data updates through actions and mutations and avoids stale or duplicated data.
- **Data Masking & Strict Selection:** fate enforces strict data selection for each view, and masks (hides) data that components did not request. This prevents accidental coupling between components and reduces overfetching.
- **Async React:** fate uses modern Async React features like Actions, Suspense, and `use` to support concurrent rendering and enable a seamless user experience.
- **Lists & Pagination:** fate provides built-in support for connection-style lists with cursor-based pagination, making it easy to implement infinite scrolling and "load-more" functionality.
- **Optimistic Updates:** fate supports declarative optimistic updates for mutations, allowing the UI to update immediately while the server request is in-flight. If the request fails, the cache and its associated views are rolled back to their previous state.
- **AI-Ready:** fate's minimal, predictable API and explicit data selection enable local reasoning, allowing AI tools to generate stable, type-safe data-fetching code.

## A modern data client for React & tRPC

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

_[Learn more](/guide/getting-started) about fate's core concepts or get started with [a ready-made template](https://github.com/nkzw-tech/fate-template#readme)._
