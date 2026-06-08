<script setup lang="ts">
defineProps<{ class?: string }>();
</script>

<template>
  <h2 :class="['text-2xl font-semibold tracking-tight text-foreground', $props.class]">
    <slot />
  </h2>
</template>
