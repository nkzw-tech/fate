<script setup lang="ts">
import { computed } from 'vue';
import cx from '../lib/cx.ts';

const props = defineProps<{ class?: string }>();

const classes = computed(() =>
  cx('rounded-lg border border-border bg-card p-5 text-card-foreground shadow-sm', props.class),
);
</script>

<template>
  <div :class="classes">
    <slot />
  </div>
</template>
