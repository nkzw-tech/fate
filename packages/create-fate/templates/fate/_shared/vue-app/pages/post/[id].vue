<script setup lang="ts">
import { useParams } from '@void/vue';
import { useRequest } from 'vue-fate';
import { PostView } from '../../src/fateViews.ts';
import PostCard from '../../src/ui/PostCard.vue';
import Section from '../../src/ui/Section.vue';

const params = useParams<{ id: string }>();
const id = params.id;

if (!id) {
  throw new Error('fate: Post ID is required.');
}

const { post } = await useRequest({
  post: { id, view: PostView },
}).ready();
</script>

<template>
  <Section>
    <PostCard :post="post" />
  </Section>
</template>
