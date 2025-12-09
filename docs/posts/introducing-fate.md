<h1 style="font-weight: 500; color: var(--vp-post-headline);">
  Introducing
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="/fate-logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="/fate-logo.svg">
    <img alt="fate" src="/fate-logo.svg" style="display: inline; height: 40px; vertical-align: middle;">
  </picture>
  <div style="display: none">

# Introducing Fate

  </div>
</h1>

<span style="color: var(--vp-c-text-2);">

_December 9<sup>th</sup> 2025 by [<img src="https://gravatar.com/avatar/77a332a7da779ef594cb6db9970c7b2f?s=128" style="border-radius: 32px; corner-shape: squircle; width: 20px; height: 20px; display: inline; vertical-align: text-bottom;" /> Christoph Nakazawa](https://x.com/cnakazawa)_

</span>

I'm excited to announce the initial alpha release of **_fate_**, a modern data client for React & tRPC. _fate_ combines view composition, normalized caching, data masking, Async React features, and tRPC's type safety.

## A modern data client for React & tRPC

<!--@include: ../parts/intro.md#a-modern-data-client-for-react-trpc-->

## Journey to _fate_

I was part of the original Relay and React teams at Facebook in 2013, but I didn't build Relay. While I worked on deploying the first server-side rendering engine for React and migrating Relay from [React mixins](https://legacy.reactjs.org/blog/2016/07/13/mixins-considered-harmful.html) to higher-order components through codemods, I honestly didn't fully grasp how far ahead everyone else on the Relay team was back then.

In the following years, Relay became the default data framework at Facebook. It was such an elegant way to handle client-side data that I had assumed it would gain widespread adoption. That didn't happen, and its backend companion GraphQL has become divisive in the web ecosystem.

I spent several years [rebuilding a stack similar to the frontend stack at Facebook](https://www.youtube.com/watch?v=rxPTEko8J7c&t=36s), using GraphQL and Relay, and even forking and rewriting abandoned Facebook libraries such as [fbtee](https://fbtee.dev). I built [Athena Crisis](https://athenacrisis.com/), a video game, and many other apps using this stack.

However, in recent months I have been exposed to the reality of React data fetching. It tends to look something like this:

```tsx
const { data: post, isLoading, isError } = useFetch(…)

if (isLoading) return <Loading />;
if (isError) return <Error />;
if (!post) return <NullState />;

return <Post post={post} />;
```

This boilerplate is repetitive and ok, but not great. The real problems start when data changes. Mutations tend to have complex logic with detailed patches to the local cache or for handling rollbacks. For example:

```tsx
mutate({
  // Complex cache patching logic or detailed cache clearing calls.
  onSuccess: (list, newItem) => {
    cache.remove('posts');
    cache.remove('post', newItem.id);
    return cache
      .get('root-posts-list')
      .map((item) => (item.id === newItem.id ? newItem : item));
  },
  // Complex rollback logic.
  onError: () => {
    cache.restore(previousCacheState);
    cache
      .get('root-posts-list')
      .map((item) => (item.id === oldItem.id ? oldItem : item));
  },
});
```

When your data client is an abstraction over `fetch`, keeping client state consistent gets hard quickly. Correctly handling mutations often requires knowing every place in your application that might fetch the same data. That often leads to defensive refetching and waterfalls down the component tree. Component trees frequently look like this:

<p align="center">
  <picture class="fetch-tree">
    <source media="(prefers-color-scheme: dark)" srcset="/public/fetch-tree-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="/public/fetch-tree.svg">
    <img alt="Tree" src="/public/fetch-tree.svg" width="90%">
  </picture>
</p>

To be clear: These libraries are _great at fetching data_. I know better patterns are available in most of these libraries, and advanced developers can avoid many of the downsides. Sync engines address these problems, but they're challenging to adopt and also come with trade-offs.

Still, it's too easy to get something wrong. Codebases become brittle and hard to maintain. Looking ahead to a world where AI increasingly writes more of our code and gravitates towards simple, idiomatic APIs, **_the problem is that these APIs exist at all_**.

## Building _fate_

I did not want to compromise on the key insights from Relay: a normalized cache, declarative data dependencies, and view co-location. At around the same time, I watched [Ricky Hanlon](https://x.com/rickyfm)'s [two](https://youtu.be/zyVRg2QR6LA?t=10908)-[part](https://youtu.be/p9OcztRyDl0?t=29075) React Conf talk about Async React and got excited to start building.

When fetch-based APIs cache data based on _requests_, people think about _when_ to fetch data, and requests happen at _every level_ of the component tree. This leads to boilerplate, complexity, and inconsistency. Instead, _fate_ caches data by _objects_, shifts thinking to _what_ data is _required_, and _composes_ data requirements up to a single request at the root.

A typical component tree in a React application using _fate_ might look like this:

<p align="center">
  <picture class="fate-tree">
    <source media="(prefers-color-scheme: dark)" srcset="/public/fate-tree-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="/public/fate-tree.svg">
    <img alt="Tree" src="/public/fate-tree.svg" width="90%">
  </picture>
</p>

## Using _fate_

_fate_'s API is minimal: _It's just JavaScript_, focused on answering: "Can we make development easier?"

### Views

Let me show you a basic _fate_ code example that declares its data requirements as a "view", co-located with a component. _fate_ requires you to explicitly "select" each field that you plan to use in your components as a "view" into your data:

```tsx
import type { Post } from '@org/server/views.ts';
import { UserView } from './UserCard.tsx';
import { useView, view, ViewRef } from 'react-fate';

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

A `ViewRef` is a reference to a concrete object of a specific type, for example a `Post` with id `7`. It contains the unique ID of the object, the type name and some _fate_-specific metadata.

_fate_ creates and manages these references for you, and you can pass them around your components as needed to resolve them against their views.

### Requests

Pass the composed views to `useRequest` at the root of your app, and it'll suspend and fetch data in a single request using tRPC's [HTTP Batch Link](https://trpc.io/docs/client/links/httpBatchLink).

```tsx
import { useRequest } from 'react-fate';
import { PostCard, PostView } from './PostCard.tsx';

export function App() {
  const { posts } = useRequest({ posts: { list: PostView } });
  return posts.map((post) => <PostCard key={post.id} post={post} />);
}
```

### Actions

_fate_ does not provide hooks for mutations like traditional data fetching libraries do. Instead, all tRPC mutations are exposed as actions for use with [`useActionState`](https://react.dev/reference/react/useActionState) and React Actions. They support optimistic updates out of the box.

A `LikeButton` component using _fate_ Actions and an async component library might look like this:

```tsx
const LikeButton = ({ post }) => {
  const fate = useFateClient();
  const [result, like] = useActionState(fate.actions.post.like, null);

  return (
    <Button
      action={() =>
        like({ input: { id: post.id }, optimistic: { likes: post.likes + 1 } })
      }
    >
      {result?.error ? 'Oops!' : 'Like'}
    </Button>
  );
};
```

When this action is called, _fate_ automatically updates all views that depend on the `likes` field of the particular `Post` object. It doesn't re-render components that didn't select that field. There's no need to manually patch or invalidate cache entries. If the action fails, _fate_ rolls back the optimistic update automatically and re-renders all affected components.

All of the above works because _fate_ has a normalized data cache under the hood, with objects stored by their ID and type name (`__typename`, e.g. `Post` or `User`), and a [tRPC backend conforming to _fate_'s requirements](/guide/server-integration), exposing `byId` and `list` queries for each data type.

You can adopt _fate_ incrementally in an existing tRPC codebase without changing your existing schema by adding these queries alongside your existing procedures.

### Clarity

With these three code examples we covered almost the entire client API surface of _fate_. As a result, the mental model of using _fate_ is dramatically simpler compared to the status quo. _fate_'s API is a joy to use and requires less code, boilerplate, and manual state management.

**_It's this clarity together with reducing the API surface that helps humans and AI write better code._**

### Async

Finally, by using modern Async React, the latest React DevTools features for Suspense and Component Tracks, the [React Compiler](https://react.dev/learn/react-compiler) and even [Hot Module Reloading (HMR) for data views](https://x.com/cnakazawa/status/1996144553603322227) work out of the box.

### Get Started

Get started with [a ready-made template](https://github.com/nkzw-tech/fate-template#readme) quickly

::: code-group

```bash [npm]
npx giget@latest gh:nkzw-tech/fate-template
```

```bash [pnpm]
pnpx giget@latest gh:nkzw-tech/fate-template
```

```bash [yarn]
yarn dlx giget@latest gh:nkzw-tech/fate-template
```

:::

`fate-template` comes with a simple tRPC backend and a React frontend using **_fate_**. It features modern tools to deliver an incredibly fast development experience. Follow its [README.md](https://github.com/nkzw-tech/fate-template#fate-quick-start-template) to get started.

Read about the [Core Concepts](/guide/core-concepts), or jump right in and learn about [Views](/guide/views).

_You can also try a runnable demo directly in your browser:_

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new?repo=nkzw-tech/fate)

## Future

<!--@include: ../parts/outro.md#future -->

<!--@include: ../parts/outro.md#how-was-fate-built-->

## Hope

Please try out _fate_ and share your feedback. I'm excited to hear what you think and how it works for you.

If **_fate_** does not live up to its promise, I hope that Relay's and _fate_'s ideas will impact future data libraries for the better.

_Thank you for reading._
