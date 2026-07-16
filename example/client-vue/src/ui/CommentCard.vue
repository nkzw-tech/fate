<script setup lang="ts">
import { X } from '@lucide/vue';
import type { Comment } from '@nkzw/fate-server/src/trpc/views.ts';
import type { ViewRef } from 'vue-fate';
import { useFateClient, useView, view } from 'vue-fate';
import { CommentView } from '../fateViews.ts';
import Button from './Button.vue';
import Link from './Link.vue';

const props = defineProps<{
  comment: ViewRef<'Comment'>;
  link?: boolean;
  post: { commentCount: number; id: string; title: string };
}>();

const fate = useFateClient();
const comment = useView(CommentView, () => props.comment);

const deleteComment = async () => {
  if (!comment.value) {
    return;
  }

  await fate.mutations.comment.delete({
    delete: true,
    input: { id: comment.value.id },
    optimistic: {
      post: { commentCount: props.post.commentCount - 1, id: props.post.id },
    },
    view: view<Comment>()({
      id: true,
      post: { commentCount: true },
    }),
  });
};
</script>

<template>
  <div
    v-if="comment"
    class="group squircle border border-gray-200/80 bg-gray-100/50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900/40"
  >
    <div class="flex justify-between gap-4">
      <p class="font-medium text-gray-900 dark:text-gray-200">
        {{ comment.author?.name ?? 'Anonymous' }}
      </p>
      <Button
        class="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
        size="sm"
        variant="ghost"
        :action="deleteComment"
      >
        <X :size="14" />
      </Button>
    </div>
    <p class="text-foreground/80">{{ comment.content }}</p>
    <Link v-if="link" class="text-blue-500 underline hover:no-underline" :to="`/post/${post.id}`">
      {{ post.title }}
    </Link>
  </div>
</template>
