<script setup lang="ts">
defineProps<{ error?: unknown }>();
</script>

<template>
  <div class="text-sm text-destructive">
    {{ error instanceof Error ? error.message : 'Something went wrong.' }}
  </div>
</template>
