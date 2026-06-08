<script setup lang="ts">
defineProps<{ class?: string }>();
</script>

<template>
  <h3 :class="['text-lg font-semibold tracking-tight text-foreground', $props.class]">
    <slot />
  </h3>
</template>
