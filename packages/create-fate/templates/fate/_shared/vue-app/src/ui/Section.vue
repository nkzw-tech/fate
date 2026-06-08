<script setup lang="ts">
import { computed } from 'vue';
import cx from '../lib/cx.ts';

const props = defineProps<{
  class?: string;
  gap?: number;
}>();

const classes = computed(() =>
  cx('container mx-auto flex max-w-5xl flex-col px-4 py-6 lg:px-8 lg:py-10', props.class),
);
</script>

<template>
  <section :class="classes" :style="{ gap: `${gap ?? 16}px` }">
    <slot />
  </section>
</template>
