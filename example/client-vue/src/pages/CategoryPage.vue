<script setup lang="ts">
import { useRequest } from 'vue-fate';
import { CategoryView } from '../fateViews.ts';
import { route } from '../router.ts';
import CategoryCard from '../ui/CategoryCard.vue';
import Section from '../ui/Section.vue';

if (route.value.name !== 'category') {
  throw new Error('fate: Category ID is required.');
}

const { category } = await useRequest(
  { category: { id: route.value.params.id, view: CategoryView } },
  { mode: 'stale-while-revalidate' },
).ready();
</script>

<template>
  <Section>
    <CategoryCard :category="category" />
  </Section>
</template>
