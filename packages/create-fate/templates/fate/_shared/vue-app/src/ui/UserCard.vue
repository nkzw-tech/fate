<script setup lang="ts">
import type { ViewRef } from 'vue-fate';
import { useView } from 'vue-fate';
import { UserView } from '../fateViews.ts';
import Card from './Card.vue';

const props = defineProps<{
  viewer: ViewRef<'User'>;
}>();

const viewer = useView(UserView, () => props.viewer);
</script>

<template>
  <Card v-if="viewer">
    <div class="space-y-2">
      <h2 class="text-sm font-medium text-muted-foreground">Viewer</h2>
      <p class="text-lg font-semibold">
        {{ viewer.name ?? viewer.username ?? viewer.id }}
      </p>
    </div>
  </Card>
</template>
