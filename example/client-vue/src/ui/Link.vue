<script setup lang="ts">
import { visit } from '../router.ts';

const props = defineProps<{
  class?: string;
  href?: string;
  to?: string;
}>();

const onClick = (event: MouseEvent) => {
  const target = props.to ?? props.href;
  if (!target || target.startsWith('http')) {
    return;
  }

  event.preventDefault();
  visit(target);
};
</script>

<template>
  <a :class="props.class" :href="to ?? href" @click="onClick">
    <slot />
  </a>
</template>
