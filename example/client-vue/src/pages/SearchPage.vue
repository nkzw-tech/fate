<script setup lang="ts">
import { defineComponent, h, ref, watch } from 'vue';
import type { ViewRef } from 'vue-fate';
import { useRequest, useView } from 'vue-fate';
import { CommentPostView, CommentSearchView } from '../fateViews.ts';
import cx from '../lib/cx.ts';
import Card from '../ui/Card.vue';
import CommentCard from '../ui/CommentCard.vue';
import Input from '../ui/Input.vue';
import Section from '../ui/Section.vue';

const query = ref('');
const deferredQuery = ref('');
let timeout: ReturnType<typeof setTimeout> | null = null;

watch(
  query,
  (value) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      deferredQuery.value = value;
    }, 120);
  },
  { immediate: true },
);

const isDevelopment = import.meta.env.DEV;

const CommentResult = defineComponent({
  name: 'CommentResult',
  props: {
    comment: {
      required: true,
      type: Object,
    },
  },
  setup(props) {
    const comment = useView(CommentSearchView, () => props.comment as ViewRef<'Comment'>);
    const post = useView(CommentPostView, () => comment.value?.post ?? null);

    return () =>
      comment.value && post.value
        ? h(CommentCard, {
            comment: props.comment as ViewRef<'Comment'>,
            link: true,
            post: post.value,
          })
        : null;
  },
});

const SearchResults = defineComponent({
  name: 'SearchResults',
  props: {
    isStale: Boolean,
    query: {
      required: true,
      type: String,
    },
  },
  setup(props) {
    const request = useRequest(() => ({
      commentSearch: { args: { query: props.query }, list: CommentSearchView },
    }));

    return () => {
      const results = request.data.value?.commentSearch ?? [];
      if (request.pending.value) {
        return h('h2', 'Thinking...');
      }

      if (results.length === 0) {
        return h('p', ['No matches for ', h('i', `"${props.query}"`)]);
      }

      return h(
        'div',
        { class: cx('flex flex-col gap-3', props.isStale && 'opacity-50') },
        results.map((comment) => h(CommentResult, { comment, key: comment.id })),
      );
    };
  },
});
</script>

<template>
  <Section>
    <Card>
      <div class="flex items-center justify-between gap-4">
        <Input v-model="query" autofocus class="w-64" placeholder="Search comments..." />
        <div v-if="isDevelopment" class="text-xs text-muted-foreground">
          500ms artificial slowdown
        </div>
      </div>
      <SearchResults
        v-if="query.trim().length > 0"
        :is-stale="query !== deferredQuery"
        :query="deferredQuery"
      />
    </Card>
  </Section>
</template>
