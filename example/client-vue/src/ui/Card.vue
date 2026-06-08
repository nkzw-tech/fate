<script setup lang="ts">
import { computed } from 'vue';
import cx from '../lib/cx.ts';

const props = defineProps<{
  class?: string;
}>();

const classes = computed(() =>
  cx(
    'squircle relative overflow-hidden border border-gray-200/70 bg-white/85 shadow-[0_16px_70px_-32px_rgba(15,23,42,0.45)] transition duration-200 ease-out hover:shadow-[0_24px_80px_-38px_rgba(15,23,42,0.55)] dark:border-neutral-800 dark:bg-neutral-900/80',
    props.class,
  ),
);
</script>

<template>
  <div :class="classes">
    <div
      class="pointer-events-none absolute inset-0 bg-linear-to-br from-blue-500/10 via-transparent to-indigo-500/15 opacity-30 transition duration-200"
    />
    <div class="relative z-10 flex h-full w-full flex-col gap-4 px-5 py-4">
      <slot />
    </div>
  </div>
</template>
