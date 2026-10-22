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
> fate batches requests made together. With tRPC, configure [HTTP Batch Link](https://trpc.io/docs/client/links/httpBatchLink) to send them in one network request.

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

For queries such as the current user, use the root name and a view:

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

Lists with different filters or sorting arguments stay separate. Loading another page extends the same list. Views that select the same objects share their cached data, and fate fetches any missing fields.

## Request Modes

`useRequest` supports different request modes to control caching and data freshness. The available modes are:

- `cache-first` (_default_): Returns data from the cache if available, otherwise fetches from the network.
- `stale-while-revalidate`: Returns data from the cache and simultaneously fetches fresh data from the network.
- `network-only`: Always fetches data from the network, bypassing the cache.
- `cache-only` (React): Observes cached data without fetching or suspending. Returns `undefined` when the selection is missing.

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

For screens that also work offline, switch the same hook to `cache-only`:

```tsx
const result = useRequest(
  { viewer: { view: ViewerView } },
  { mode: isOnline ? 'network-only' : 'cache-only' },
);
const viewer = useView(ViewerView, result?.viewer);
```

Cache-only results stay subscribed to cache changes. Their references never fetch missing view fields. Switching offline bypasses a pending Suspense gate immediately, so the component can keep its local state and render its offline UI. The existing network modes keep their required result type; modes that can be `cache-only` return an optional result.

## Refreshing Requests

To refresh posts already displayed by `useRequest`, call `useRefetch` with the same request:

```tsx
import { useRefetch } from 'react-fate';
import { PostView } from './PostCard.tsx';

export function RefreshButton() {
  const refetch = useRefetch({ posts: { list: PostView } });

  return <button onClick={() => refetch().catch(reportError)}>Refresh posts</button>;
}
```

`refetch()` fetches fresh data while the current posts stay visible. Its promise resolves with the new result or rejects on failure. Replace `reportError` with your app's error handler. Vue has the same [refresh API](/guide/vue#refreshing-requests).

## Timeouts and Cancellation

You can limit how long a request waits by passing a `timeout` in milliseconds:

```tsx
const { posts } = useRequest({ posts: { list: PostView } }, { timeout: 10_000 });
```

Requests have no timeout by default. A timeout raises a `TimeoutError`, which `useRequest` sends to your error boundary. Retrying starts a new timeout.

To cancel a request, pass an `AbortSignal` and call `abort()` when the result is no longer needed:

```tsx
const controller = new AbortController();
const request = client.request({ posts: { list: PostView } }, { signal: controller.signal });

controller.abort();

try {
  await request;
} catch (error) {
  // Handle cancellation or a failed request.
}
```

Cancellation rejects with `signal.reason`, usually an `AbortError`. If callers share a request, cancelling one does not cancel the others.

You can also use `timeout` and `signal` with `useRefetch`, `useRequestState`, and Vue requests. Keep the signal stable when passing it to a hook. These options apply to the request, including its background refresh, rather than later pagination or mutation calls.

## Cache Lifetime

fate keeps a screen's data in memory while its `useRequest` is mounted. After you leave, it keeps the 10 most recently released requests so navigating back can reuse their data.

You can change that number when creating the client:

```tsx
const fate = createClient({
  gcReleaseBufferSize: 20,
  roots,
  transport,
  types,
});
```

Set `gcReleaseBufferSize` to `0` to release data as soon as a screen unmounts. If data has been collected, the next request fetches it again.

Outside a component, use `retain` when you need to keep a request's data in memory:

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

## SSR and Hydration

Create a separate fate client for each server request and load the route's data before rendering:

```tsx
const fate = createFateClient();
await fate.request({ post: { id: '12', view: PostView } });

return {
  fate: fate.dehydrate(),
};
```

Pass the snapshot through your framework's loader or server component props. In the browser, hydrate the client before rendering:

```tsx
const fate = createFateClient();
fate.hydrate(loaderData.fate);

hydrateRoot(
  document,
  <FateClient client={fate}>
    <App />
  </FateClient>,
);
```

`cache-first` requests can now use the server's data without refetching. Await preloading before calling `dehydrate`, and hydrate before starting browser requests.

Generated clients set a hydration scope automatically. When creating a client manually, set `hydrationScope` and change it when deploying incompatible data models:

```tsx
const fate = createClient({
  hydrationScope: 'storefront-v2',
  // ...
});
```

By default, hydration adds missing data and preserves values already in the browser cache. To replace existing values with the snapshot instead, pass `merge: 'replace'`:

```tsx
fate.hydrate(loaderData.fate, { merge: 'replace' });
```

Snapshots from different hydration scopes cannot be combined. Keep each user's server client and snapshot separate.

## Observing Request State

For a search box or a screen that handles loading and errors itself, use `useRequestState` instead of Suspense:

```tsx
const state = useRequestState(request, { mode: 'stale-while-revalidate' });

// In a button's event handler:
const refresh = () => state.refetch().catch(reportError);
```

The result contains `data`, `error`, `isFetching`, `status`, and `refetch`. Data contains the same refs as `useRequest`, so child components can read them with `useView`. During a refresh, cached data stays visible and `isFetching` is true. A failed refresh sets `error` and keeps the previous data.

Use `enabled: false` to wait for input before fetching, or `mode: 'cache-only'` to read only cached data. The possible statuses are:

| Status     | Meaning                                            |
| ---------- | -------------------------------------------------- |
| `disabled` | The request is not enabled.                        |
| `missing`  | A cache-only request needs data that isn't cached. |
| `pending`  | The initial request is loading.                    |
| `ready`    | Data is available.                                 |
| `error`    | The initial request failed.                        |

`refetch()` returns a promise and requires an enabled request that isn't cache-only. For Vue, see [Request State](/guide/vue#request-state). Outside a component, `fate.observeRequest(request, options)` provides the same state through `getSnapshot()` and `subscribe(listener)`. Subscribing starts the request; unsubscribing releases it.

## Aliases

Use `alias(sourceField, selection)` to select one schema field under multiple
result names, with independent arguments:

```ts
const GamesView = view<User>()({
  activeGames: alias('games', {
    args: { first: 20, status: 'Active' },
    items: { node: GameView },
    pagination: { hasNext: true, nextCursor: true },
  }),
  waitingGames: alias('games', {
    args: { first: 20, status: 'Waiting' },
    items: { node: GameView },
  }),
  displayName: alias('name', true),
});

const request = { currentUser: alias('viewer', { view: GamesView }) };
```

The result uses the names you choose, while fate keeps data with the same source field and arguments shared in the cache. Different filters keep separate lists and pagination. `id` and `__typename` cannot be used as alias names.

GraphQL can request these variants in one operation. Other transports may make separate reads. Selecting multiple argument variants in a single mutation currently requires a transport with native alias support, such as GraphQL.
