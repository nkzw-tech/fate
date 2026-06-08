<script setup lang="ts">
import type { ViewRef } from 'vue-fate';
import { useView } from 'vue-fate';
import { TagView } from '../fateViews.ts';
import Badge from './Badge.vue';

const props = defineProps<{
  tag: ViewRef<'Tag'>;
}>();

const tag = useView(TagView, () => props.tag);
</script>

<template>
  <Badge variant="outline">{{ tag?.name }}</Badge>
</template>
