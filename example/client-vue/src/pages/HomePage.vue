<script setup lang="ts">
import { ref } from 'vue';
import type { ViewRef } from 'vue-fate';
import { useListView, useRequest } from 'vue-fate';
import { CategoryView, EventView, PostView, UserCardView } from '../fateViews.ts';
import cx from '../lib/cx.ts';
import Button from '../ui/Button.vue';
import Card from '../ui/Card.vue';
import CategoryCard from '../ui/CategoryCard.vue';
import CreatePost from '../ui/CreatePost.vue';
import EventCard from '../ui/EventCard.vue';
import H2 from '../ui/H2.vue';
import Link from '../ui/Link.vue';
import PostCard from '../ui/PostCard.vue';
import Section from '../ui/Section.vue';
import UserCard from '../ui/UserCard.vue';
import AuthClient from '../user/AuthClient.ts';

const PostConnectionView = {
  args: { first: 3 },
  items: {
    node: PostView,
  },
  pagination: {
    hasNext: true,
  },
};

const session = AuthClient.useSession();
const user = session.value.data?.user;
const showPostEditor = ref(false);
const request = useRequest({
  categories: { list: CategoryView },
  events: { list: EventView },
  posts: { list: PostConnectionView },
  viewer: { view: UserCardView },
});
const { categories, events, posts: postsRef, viewer } = await request.ready();
const [posts, loadNext] = useListView(PostConnectionView, postsRef);
</script>

<template>
  <Section :gap="32">
    <div :class="cx('grid gap-8 lg:items-stretch', user ? 'lg:grid-cols-[1.6fr_1fr]' : '')">
      <Card
        class="border border-white/20 bg-linear-to-r from-blue-500 to-sky-500 text-white dark:from-blue-600 dark:to-sky-600"
      >
        <div class="flex flex-wrap items-center gap-3">
          <span
            class="squircle bg-white/20 px-2 py-1 text-xs font-semibold tracking-widest uppercase"
          >
            <span class="lowercase italic">fate</span> demo
          </span>
        </div>
        <div class="space-y-3">
          <h1 class="text-3xl leading-tight font-semibold text-balance lg:text-4xl">
            fate is a modern data client for Vue inspired by Relay and GraphQL.
          </h1>
          <p class="text-sm text-white/80 lg:text-base">
            fate combines view composition, normalized caching, data masking, Vue-native
            composables, and type-safe data fetching.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <template v-if="!user">
            <Button size="sm" variant="secondary">
              <Link class="squircle px-4 py-2 text-sm font-semibold" to="/login">Login</Link>
            </Button>
            <span class="text-sm text-white/80">Sign in to post comments.</span>
          </template>
        </div>
      </Card>
      <UserCard v-if="viewer" :viewer="viewer" />
    </div>
    <div class="grid gap-8 lg:grid-cols-[1.6fr_1fr] lg:items-start">
      <div v-if="posts.length" class="flex flex-col gap-4">
        <div class="flex items-center justify-between gap-4">
          <H2 class="pl-5">Latest posts</H2>
          <div>
            <button
              :class="
                cx(
                  'pr-5 text-2xl leading-none',
                  viewer
                    ? 'active:translate-y-0.5 active:opacity-50'
                    : 'pointer-events-none opacity-0',
                )
              "
              @click="showPostEditor = !showPostEditor"
            >
              {{ showPostEditor ? '-' : '+' }}
            </button>
          </div>
        </div>
        <div class="flex flex-col gap-8">
          <CreatePost v-if="showPostEditor" :user="viewer as ViewRef<'User'> | null" />
          <PostCard v-for="{ node } in posts" :key="node.id" :post="node" />
          <div v-if="loadNext" class="flex justify-center">
            <Button variant="ghost" :action="loadNext">Load more posts</Button>
          </div>
        </div>
      </div>
      <div class="flex flex-col gap-6">
        <div v-if="categories.length" class="flex flex-col gap-4">
          <H2 class="pl-5">Explore by theme</H2>
          <div class="flex flex-col gap-6">
            <CategoryCard v-for="category in categories" :key="category.id" :category="category" />
          </div>
        </div>
        <div v-if="events.length" class="flex flex-col gap-4">
          <H2 class="pl-5">Events</H2>
          <div class="flex flex-col gap-6">
            <EventCard v-for="event in events" :key="event.id" :event="event" />
          </div>
        </div>
      </div>
    </div>
  </Section>
</template>
