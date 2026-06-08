<script setup lang="ts">
import { Link as VoidLink } from '@void/vue';

defineProps<{
  class?: string;
  href?: string;
  to?: string;
}>();
</script>

<template>
  <VoidLink :class="$props.class" :href="href ?? to ?? '/'">
    <slot />
  </VoidLink>
</template>
