<script setup lang="ts">
import { Link as VoidLink } from '@void/vue';
import type { Href } from 'void/routes';

defineProps<{
  class?: string;
  href?: Href;
  to?: Href;
}>();
</script>

<template>
  <VoidLink :class="$props.class" :href="href ?? to ?? '/'">
    <slot />
  </VoidLink>
</template>
