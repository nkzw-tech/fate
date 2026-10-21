# Vue

_fate_ supports Vue through `vue-fate`, with the same views, requests, cache, and mutations as the React adapter. Request and view composables expose reactive Vue resources, with `<Suspense>` support for loading states.

## Installation

Install `vue-fate` in your Vue client:

::: code-group

```bash [npm]
npm add vue-fate
```

```bash [pnpm]
pnpm add vue-fate
```

```bash [yarn]
yarn add vue-fate
```

:::

If your server lives in a separate package, install `@nkzw/fate` there as a runtime dependency too.

## Vite Plugin

Use the Vue adapter's Vite plugin in the client app:

```ts
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { fate } from 'vue-fate/vite';

export default defineConfig({
  plugins: [
    vue(),
    fate({
      module: '@your-org/server/fate.ts',
      transport: 'native',
    }),
  ],
});
```

The plugin generates `vue-fate/client`, which contains the typed `createFateClient` helper for your app. The `module` and `transport` options are the same options used by the React adapter.

## Providing the Client

Create a client with `createFateClient` and provide it with `FateClient`:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { FateClient } from 'vue-fate';
import { createFateClient } from 'vue-fate/client';
import AppRoutes from './AppRoutes.vue';

const token = ref<string | null>(null);

const fate = computed(() =>
  createFateClient({
    headers: () => ({
      authorization: token.value ? `Bearer ${token.value}` : '',
    }),
    url: '/fate',
  }),
);
</script>

<template>
  <FateClient :client="fate">
    <Suspense>
      <AppRoutes />
    </Suspense>
  </FateClient>
</template>
```

The `client` prop accepts a plain client, a ref, a computed value, or a getter. Descendants always read the current client, so switching credentials, endpoints, or transports does not require remounting the provider.

You can also install the client as a Vue plugin:

```ts
import { createApp } from 'vue';
import { createFatePlugin } from 'vue-fate';
import { createFateClient } from 'vue-fate/client';
import App from './App.vue';

const fate = createFateClient({ url: '/fate' });

createApp(App).use(createFatePlugin(fate)).mount('#app');
```

## Defining Views

Views are plain TypeScript values and can live anywhere. In Vue apps, it is usually best to define shared views in `.ts` modules and import them from single-file components:

```ts
import type { Post, User } from '@your-org/server/views';
import { view } from 'vue-fate';

export const UserView = view<User>()({
  id: true,
  name: true,
  username: true,
});

export const PostView = view<Post>()({
  author: UserView,
  id: true,
  title: true,
});
```

Vue can import values across components, but single-file components have one default component export. Keeping reusable views in `.ts` files avoids coupling your data model to component files and makes view composition straightforward.

## Requests

`useRequest` declares the data a route, page, or component tree needs. It returns a resource with `data`, `pending`, `error`, `ready`, `refresh`, and `dispose`:

```vue
<script setup lang="ts">
import { useListView, useRequest } from 'vue-fate';
import { PostCardView } from '../fateViews';
import PostCard from '../ui/PostCard.vue';

const request = useRequest({
  posts: {
    args: { first: 20 },
    list: PostCardView,
  },
});

await request.ready();
const [postItems, loadNext] = useListView(PostCardView, () => request.data.value?.posts);
</script>

<template>
  <PostCard v-for="{ node } in postItems" :key="node.id" :post="node" />
  <button v-if="loadNext" @click="loadNext()">Load more</button>
</template>
```

Awaiting `ready()` in `<script setup>` participates in Vue Suspense. The getter passed to `useListView` keeps the list in sync when the request result changes. To render loading and error states yourself, use `useRequestState` instead.

## Request State

Use `useRequestState` to render loading and error states without Suspense:

```vue
<script setup lang="ts">
import { useRequestState } from 'vue-fate';
import { UserView } from '../fateViews';
import UserCard from '../ui/UserCard.vue';

const state = useRequestState({ viewer: { view: UserView } }, { mode: 'stale-while-revalidate' });
</script>

<template>
  <p v-if="state.isFetching">Loading…</p>
  <p v-if="state.error">Could not load your profile.</p>
  <UserCard v-if="state.data?.viewer" :user="state.data.viewer" />
</template>
```

The result is a ref: use `state.value` in script, while templates unwrap it automatically. Its data contains view refs, which components such as `UserCard` resolve with `useView`. Cached data stays visible during a refresh, and `isFetching` and `error` report its progress and failures.

The request and options accept plain values, refs, or getters. Pass `{ enabled: false }` to disable fetching, or `{ mode: 'cache-only' }` to observe cached data without fetching missing fields. The `status` is `disabled`, `missing`, `pending`, `ready`, or `error`, as described in [Observing Request State](/guide/requests#observing-request-state).

Call `state.value.refetch()` to fetch fresh data. Handle its rejected promise in the calling code. Disabled and cache-only requests reject refetches. Vue cleans up the observer when the component unmounts; call `state.dispose()` to stop it earlier.

## Refreshing Requests

Use `useRefetch` to refresh data from a button or event handler:

```vue
<script setup lang="ts">
import { useRefetch } from 'vue-fate';
import { UserView } from '../fateViews';

const refresh = useRefetch({ viewer: { view: UserView } });
</script>

<template>
  <button @click="refresh().catch(reportError)">Refresh profile</button>
</template>
```

The composable waits until you call `refresh()` to fetch from the network. Existing data stays visible, and request and view resources update when the result arrives. Handle failures in the event handler; `reportError` above represents your application's error handler.

Requests and options can be refs or getters. Each call uses their current values. The optional second argument accepts `persist`, `timeout`, and `signal`; see [Timeouts and Cancellation](/guide/requests#timeouts-and-cancellation).

## Views in Components

Use `useView` to read a `ViewRef` from the normalized cache and subscribe to updates for the selected fields:

```vue
<script setup lang="ts">
import type { ViewRef } from 'vue-fate';
import { useView } from 'vue-fate';
import { PostCardView, UserView } from '../fateViews';
import UserCard from './UserCard.vue';

const props = defineProps<{
  post: ViewRef<'Post'>;
}>();

const post = useView(PostCardView, () => props.post);
const author = useView(UserView, () => post.value?.author ?? null);
</script>

<template>
  <article v-if="post">
    <h2>{{ post.title }}</h2>
    <UserCard v-if="author" :user="author" />
  </article>
</template>
```

Pass reactive props through a getter so fate tracks prop changes. In script, resources are refs and need `.value`. In templates, Vue unwraps them automatically.

## Resolving Arrays of Refs

Use `useViews` when one component needs selected data from an array of refs, for example to filter or sort before rendering:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { useViews, type ViewRef } from 'vue-fate';
import { PostCardView } from '../fateViews';

const props = defineProps<{ posts: ReadonlyArray<ViewRef<'Post'>> }>();
const posts = useViews(PostCardView, () => props.posts);
const sorted = computed(() => [...posts.value].sort((a, b) => a.title.localeCompare(b.title)));

await posts.ready();
</script>

<template>
  <h2 v-for="post in sorted" :key="post.id">{{ post.title }}</h2>
</template>
```

Pass a plain array, ref, or getter, as you would with `useView`. The result follows the input order and updates when the refs or their selected fields change. Deferred refs are supported, and `null` or `undefined` entries keep their values in the result.

The resource has the same members as `useView`. Await `ready()` in async setup to use Vue Suspense, or render the pending and error states yourself. Before the first read finishes, `.value` is an empty array. Later reads keep the previous data while loading.

## Lists and Live Views

`useListView` subscribes to a connection returned from `useRequest` or from a nested view field:

```ts
const [comments, loadNextCommentPage] = useListView(CommentView, () => post.value?.comments);
```

The items and pagination helpers are refs. If the connection is `null` or `undefined`, `comments.value` is `undefined` and both pagination helper values are `null`. A connection with `items: []` returns an empty array. Use `comments.value ?? []` when you want to treat missing comments as an empty list. `useLiveListView` follows the same rules.

`useLiveView` and `useLiveListView` have the same resource shape as `useView` and `useListView`, but they also subscribe to server-pushed updates when the selected transport supports live views:

```ts
const post = useLiveView(PostCardView, () => props.post);
const [comments] = useLiveListView(CommentView, () => post.value?.comments);
```

Vue cleans up resources when the component unmounts. Call `dispose()` to stop a resource earlier.

## Mutations

Use `useFateClient` to access generated mutations:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useFateClient } from 'vue-fate';

const props = defineProps<{
  post: { id: string; likes: number };
}>();

const fate = useFateClient();
const pending = ref(false);
const error = ref<unknown>(null);

const like = async () => {
  pending.value = true;
  error.value = null;

  try {
    const result = await fate.mutations.post.like({
      input: { id: props.post.id },
      optimistic: { likes: props.post.likes + 1 },
    });
    error.value = result.error ?? null;
  } catch (caughtError) {
    error.value = caughtError;
  } finally {
    pending.value = false;
  }
};
</script>

<template>
  <button :disabled="pending" @click="like">Like</button>
  <p v-if="error">Could not like this post.</p>
</template>
```

Expected mutation errors are returned in `result.error`; unexpected failures reject the promise. See [Action & Mutation Error Handling](/guide/actions#action--mutation-error-handling).

The mutation call shape is the same as `react-fate`: `input`, `optimistic`, `insert`, and `view` work the same way. Vue does not have React Actions or `useActionState`, so Vue components should model pending and error state with Vue refs or your application state library.

## API Differences from React

The names intentionally mirror `react-fate` where Vue has an equivalent API. The main differences are Vue framework differences:

- `useRequest`, `useView`, `useViews`, and list hooks return Vue resources instead of throwing promises from render.
- Async setup and `<Suspense>` replace React's async component model.
- Mutations use `fate.mutations` directly; React-only `fate.actions` and `useActionState` patterns do not apply.
- Shared views are best kept in `.ts` modules instead of exporting named views from component files.

The generated client, server integrations, cache behavior, masking, pagination, optimistic updates, and live transport behavior are shared across adapters.
