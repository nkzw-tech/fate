<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue';
import Card from './Card.vue';
import Error from './Error.vue';
import Section from './Section.vue';

const error = ref<unknown>(null);

onErrorCaptured((capturedError) => {
  error.value = capturedError;
  return false;
});
</script>

<template>
  <Section v-if="error">
    <Card>
      <Error :error="error" />
    </Card>
  </Section>
  <slot v-else />
</template>
