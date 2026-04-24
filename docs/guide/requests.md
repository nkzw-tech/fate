# Requests

## Requesting Lists

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
> `useRequest` might issue multiple requests which are automatically batched together by tRPC's [HTTP Batch Link](https://trpc.io/docs/client/links/httpBatchLink) into a single network request.

## Requesting Objects by ID

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

## Other Types of Requests

For any other queries, pass only the `type` and `view`:

```tsx
const { viewer } = useRequest({
  viewer: { view: UserView },
});
```

## Request Arguments

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

## Request Modes

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

## Cache Lifetime

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
