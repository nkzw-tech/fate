<script setup lang="ts">
import { httpBatchLink } from '@trpc/client';
import { computed } from 'vue';
import { FateClient } from 'vue-fate';
import { createFateClient } from 'vue-fate/client';
import env from './lib/env.ts';
import CategoryPage from './pages/CategoryPage.vue';
import HomePage from './pages/HomePage.vue';
import LoginPage from './pages/LoginPage.vue';
import PostPage from './pages/PostPage.vue';
import SearchPage from './pages/SearchPage.vue';
import { route } from './router.ts';
import ErrorBoundary from './ui/ErrorBoundary.vue';
import Header from './ui/Header.vue';
import Thinking from './ui/Thinking.vue';
import AuthClient from './user/AuthClient.ts';

const session = AuthClient.useSession();

const fate = computed(() => {
  const userId = session.value.data?.user.id;
  const credentialFetch = userId
    ? (input: string | URL | Request, init?: RequestInit) =>
        fetch(input, {
          ...init,
          credentials: 'include',
        })
    : undefined;

  return createFateClient({
    links: [
      httpBatchLink({
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            credentials: userId ? 'include' : undefined,
          }),
        url: `${env('SERVER_URL')}/trpc`,
      }),
    ],
    liveUrl: `${env('SERVER_URL')}/fate`,
    ...(credentialFetch ? { fetch: credentialFetch } : null),
  });
});

const routeComponent = computed(() => {
  switch (route.value.name) {
    case 'category':
      return CategoryPage;
    case 'login':
      return LoginPage;
    case 'post':
      return PostPage;
    case 'search':
      return SearchPage;
    case 'home':
    default:
      return HomePage;
  }
});
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <div
      class="min-h-screen bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_80%_0,rgba(99,102,241,0.08),transparent_28%)]"
    >
      <Header />
      <Thinking v-if="session.isPending" />
      <FateClient v-else :key="session.data?.user.id ?? 'anonymous'" :client="fate">
        <ErrorBoundary>
          <Suspense timeout="0">
            <component
              :is="routeComponent"
              :key="`${route.name}:${JSON.stringify(route.params)}`"
            />
            <template #fallback>
              <Thinking />
            </template>
          </Suspense>
        </ErrorBoundary>
      </FateClient>
    </div>
  </div>
</template>
