<script setup lang="ts">
defineProps<{ error?: unknown }>();
</script>

<template>
  <div class="text-sm text-red-600 dark:text-red-400">
    {{ error instanceof Error ? error.message : 'Something went wrong.' }}
  </div>
</template>
