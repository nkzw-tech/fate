<script setup lang="ts">
import { cva, type VariantProps } from 'class-variance-authority';
import { computed, ref } from 'vue';
import cx from '../lib/cx.ts';

const buttonVariants = cva(
  'squircle inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        default: 'h-10 px-3 py-2',
        sm: 'h-9 px-2',
      },
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        ghost: 'hover:bg-secondary hover:text-secondary-foreground',
        outline: 'border border-border bg-background hover:bg-secondary',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
      },
    },
  },
);

type ButtonVariants = VariantProps<typeof buttonVariants>;

const props = withDefaults(
  defineProps<{
    action?: () => Promise<unknown> | unknown;
    class?: string;
    disabled?: boolean;
    size?: ButtonVariants['size'];
    type?: 'button' | 'submit';
    variant?: ButtonVariants['variant'];
  }>(),
  {
    type: 'button',
  },
);

const isPending = ref(false);
const classes = computed(() =>
  cx(buttonVariants({ size: props.size, variant: props.variant }), props.class),
);

const onClick = async () => {
  if (!props.action || isPending.value || props.disabled) {
    return;
  }

  isPending.value = true;
  try {
    await props.action();
  } finally {
    isPending.value = false;
  }
};
</script>

<template>
  <button :class="classes" :disabled="disabled || isPending" :type="type" @click="onClick">
    <slot />
  </button>
</template>
