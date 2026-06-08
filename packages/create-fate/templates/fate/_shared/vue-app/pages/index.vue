<script setup lang="ts">
import { useListView, useRequest } from 'vue-fate';
import { PostView, UserView } from '../src/fateViews.ts';
import Button from '../src/ui/Button.vue';
import Card from '../src/ui/Card.vue';
import PostCard from '../src/ui/PostCard.vue';
import Section from '../src/ui/Section.vue';
import UserCard from '../src/ui/UserCard.vue';

const PostConnectionView = {
  args: { first: 10 },
  items: {
    node: PostView,
  },
  pagination: {
    hasNext: true,
  },
};

const request = useRequest({
  posts: { list: PostConnectionView },
  viewer: { view: UserView },
});
const { posts: postsRef, viewer } = await request.ready();
const [posts, loadNext] = useListView(PostConnectionView, postsRef);
</script>

<template>
  <Section :gap="32">
    <div class="grid gap-8 lg:grid-cols-[1.6fr_1fr] lg:items-stretch">
      <Card class="border border-white/20 bg-linear-to-r from-blue-500 to-sky-500 text-white">
        <div class="space-y-3">
          <p class="text-xs font-semibold tracking-widest uppercase">
            <span class="lowercase italic">fate</span> demo
          </p>
          <h1 class="text-3xl leading-tight font-semibold text-balance lg:text-4xl">
            fate is a modern data client for Vue inspired by Relay and GraphQL.
          </h1>
          <p class="text-sm text-white/80 lg:text-base">
            This template uses Vue-native fate composables, normalized caching, data masking, and
            type-safe data fetching.
          </p>
        </div>
      </Card>
      <UserCard v-if="viewer" :viewer="viewer" />
    </div>
    <div v-if="posts.length" class="flex flex-col gap-4">
      <h2 class="pl-5 text-2xl font-semibold tracking-tight">Latest posts</h2>
      <div class="flex flex-col gap-4">
        <PostCard v-for="{ node } in posts" :key="node.id" :post="node" />
      </div>
      <div v-if="loadNext" class="flex justify-center">
        <Button :action="loadNext" variant="ghost">Load more posts</Button>
      </div>
    </div>
  </Section>
</template>
