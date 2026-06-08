<script setup lang="ts">
import { computed } from 'vue';
import cx from '../lib/cx.ts';

const props = defineProps<{
  class?: string;
  modelValue?: boolean | string;
  type?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean | string];
}>();

const classes = computed(() =>
  cx(
    'border-input squircle flex w-32 border bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-900/40',
    props.type === 'checkbox'
      ? "duration-150ms relative h-6 w-6 shrink-0 cursor-pointer appearance-none p-0 after:absolute after:inset-0.5 after:h-4.5 after:w-4.5 after:rounded-4xl after:bg-foreground/60 after:opacity-0 after:transition-opacity after:content-[''] after:[corner-shape:squircle] checked:border-foreground/50 checked:after:block checked:after:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
      : null,
    props.class,
  ),
);

const onInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  emit('update:modelValue', props.type === 'checkbox' ? target.checked : target.value);
};
</script>

<template>
  <input
    :checked="type === 'checkbox' ? Boolean(modelValue) : undefined"
    :class="classes"
    :type="type ?? 'text'"
    :value="type === 'checkbox' ? undefined : modelValue"
    @input="onInput"
  />
</template>
