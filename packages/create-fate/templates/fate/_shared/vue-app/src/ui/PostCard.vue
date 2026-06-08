<script setup lang="ts">
import type { ViewRef } from 'vue-fate';
import { useView } from 'vue-fate';
import { PostView, UserView } from '../fateViews.ts';
import Card from './Card.vue';
import Link from './Link.vue';

const props = defineProps<{
  post: ViewRef<'Post'>;
}>();

const post = useView(PostView, () => props.post);
const author = useView(UserView, () => post.value?.author ?? null);
</script>

<template>
  <Card v-if="post">
    <article class="space-y-3">
      <div>
        <Link class="text-lg font-semibold hover:underline" :href="`/post/${post.id}`">
          {{ post.title }}
        </Link>
        <p v-if="author" class="mt-1 text-sm text-muted-foreground">
          By {{ author.name ?? author.username ?? author.id }}
        </p>
      </div>
    </article>
  </Card>
</template>
