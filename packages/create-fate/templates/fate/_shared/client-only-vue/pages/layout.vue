<script setup lang="ts">
import '../src/style.css';
import { Link } from '@void/vue';
import { onErrorCaptured, ref } from 'vue';
import { FateClient } from 'vue-fate';
import { getTaskClient } from '../src/state.ts';

const client = getTaskClient();
const error = ref('');
onErrorCaptured((cause) => {
  error.value = String(cause);
  return false;
});
</script>

<template>
  <nav aria-label="Main navigation">
    <Link href="/">Tasks</Link>
    <Link href="/about">About</Link>
  </nav>
  <main>
    <p v-if="error" role="alert">{{ error }}</p>
    <FateClient v-else :client="client">
      <Suspense>
        <slot />
        <template #fallback><p>Restoring tasks…</p></template>
      </Suspense>
    </FateClient>
  </main>
</template>
