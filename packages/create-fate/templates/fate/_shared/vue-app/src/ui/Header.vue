<script setup lang="ts">
import { Search } from '@lucide/vue';
import { Link } from '@void/vue';
import Button from './Button.vue';
</script>

<template>
  <header
    class="sticky top-0 z-50 border-b border-white/60 bg-white/60 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/70"
  >
    <div class="container mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-6">
      <Link class="flex items-center gap-3" href="/">
        <div
          class="squircle flex h-10 w-10 items-center justify-center bg-linear-to-br from-gray-100 to-gray-200 text-gray-500 shadow-lg shadow-gray-500/20"
        >
          f
        </div>
        <div>
          <span
            class="bg-linear-to-r from-gray-500 to-gray-900 bg-clip-text text-xl font-semibold text-transparent dark:from-gray-200 dark:to-white"
          >
            <span class="italic">fate</span>
          </span>
          <p class="hidden text-xs text-muted-foreground sm:block">A modern data client for Vue.</p>
        </div>
      </Link>
      <Button size="sm" variant="ghost">
        <Link class="inline-flex items-center gap-2" href="/">
          <Search class="h-4 w-4" />
          <span class="hidden sm:inline">Home</span>
        </Link>
      </Button>
    </div>
  </header>
</template>
