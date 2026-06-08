<script setup lang="ts">
import { useRequest } from 'vue-fate';
import { PostView } from '../fateViews.ts';
import { route } from '../router.ts';
import PostCard from '../ui/PostCard.vue';
import Section from '../ui/Section.vue';

if (route.value.name !== 'post') {
  throw new Error('fate: Post ID is required.');
}

const { post } = await useRequest({
  post: { id: route.value.params.id, view: PostView },
}).ready();
</script>

<template>
  <Section>
    <PostCard detail :post="post" />
  </Section>
</template>
