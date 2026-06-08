<script setup lang="ts">
import '../src/App.css';
import { computed } from 'vue';
import { FateClient } from 'vue-fate';
import { createFateClient } from 'vue-fate/client';
/* __CLIENT_IMPORTS__ */
import ErrorBoundary from '../src/ui/ErrorBoundary.vue';
import Header from '../src/ui/Header.vue';
import Thinking from '../src/ui/Thinking.vue';

const fate = computed(() => createFateClient(__CREATE_FATE_OPTIONS__));
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <div
      class="min-h-screen bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_80%_0,rgba(99,102,241,0.08),transparent_28%)]"
    >
      <Header />
      <FateClient :client="fate">
        <ErrorBoundary>
          <Suspense timeout="0">
            <slot />
            <template #fallback>
              <Thinking />
            </template>
          </Suspense>
        </ErrorBoundary>
      </FateClient>
    </div>
  </div>
</template>
