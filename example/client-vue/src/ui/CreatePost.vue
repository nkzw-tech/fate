<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ViewRef } from 'vue-fate';
import { useFateClient, useView } from 'vue-fate';
import { PostView, UserCardView } from '../fateViews.ts';
import Button from './Button.vue';
import Card from './Card.vue';
import H3 from './H3.vue';
import Input from './Input.vue';

const props = defineProps<{
  user: ViewRef<'User'> | null;
}>();

const fate = useFateClient();
const user = useView(UserCardView, () => props.user);
const contentValue = ref('');
const titleValue = ref('');
const missingOptimisticContent = ref(false);
const missingMutationSelection = ref(false);
const isPending = ref(false);

const postingIsDisabled = computed(
  () =>
    isPending.value ||
    titleValue.value.trim().length === 0 ||
    contentValue.value.trim().length === 0,
);

const submit = async () => {
  const content = contentValue.value.trim();
  const title = titleValue.value.trim();

  if (!content || !title || !user.value || postingIsDisabled.value) {
    return;
  }

  isPending.value = true;
  try {
    await fate.mutations.post.add({
      input: { content, title },
      insert: 'before',
      optimistic: missingOptimisticContent.value
        ? {
            author: user.value,
            comments: [],
            id: `optimistic:${Date.now().toString(36)}`,
            title,
          }
        : {
            author: user.value,
            commentCount: 0,
            comments: [],
            content,
            id: `optimistic:${Date.now().toString(36)}`,
            likes: 0,
            title,
          },
      ...(missingMutationSelection.value ? null : { view: PostView }),
    });

    contentValue.value = '';
    titleValue.value = '';
  } finally {
    isPending.value = false;
  }
};

const maybeSubmitPost = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    void submit();
  }
};
</script>

<template>
  <Card>
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <H3>Create a Post</H3>
      <Input
        v-model="titleValue"
        class="w-full"
        :disabled="isPending"
        placeholder="Post Title"
        @keydown="maybeSubmitPost"
      />
      <textarea
        v-model="contentValue"
        class="squircle border-input flex min-h-20 w-full border bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-900/40"
        :disabled="isPending"
        placeholder="Share your thoughts about fate..."
        @keydown="maybeSubmitPost"
      />
      <div class="flex flex-wrap items-center justify-between gap-4 text-sm">
        <span class="font-bold">Mutation Debug Options</span>
        <label class="flex items-center gap-2">
          <Input v-model="missingMutationSelection" :disabled="isPending" type="checkbox" />
          Missing mutation selection
        </label>
        <label class="flex items-center gap-2">
          <Input v-model="missingOptimisticContent" :disabled="isPending" type="checkbox" />
          Missing optimistic content
        </label>
      </div>
      <div class="flex items-center justify-end gap-4">
        <Button :disabled="postingIsDisabled" size="sm" type="submit" variant="secondary">
          Post comment
        </Button>
      </div>
    </form>
  </Card>
</template>
