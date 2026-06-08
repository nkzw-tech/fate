<script setup lang="ts">
import { defineComponent, h, type PropType } from 'vue';
import type { ViewRef } from 'vue-fate';
import { useView } from 'vue-fate';
import { CategoryPostView, CategoryView, UserView } from '../fateViews.ts';
import Badge from './Badge.vue';
import Card from './Card.vue';
import H3 from './H3.vue';
import Link from './Link.vue';
import TagBadge from './TagBadge.vue';

const props = defineProps<{
  category: ViewRef<'Category'>;
}>();

const category = useView(CategoryView, () => props.category);

const CategoryPost = defineComponent({
  name: 'CategoryPost',
  props: {
    post: {
      required: true,
      type: Object as PropType<ViewRef<'Post'>>,
    },
  },
  setup(props) {
    const post = useView(CategoryPostView, () => props.post);
    const author = useView(UserView, () => post.value?.author ?? null);

    return () =>
      post.value
        ? h('div', { class: 'flex flex-col gap-1', key: post.value.id }, [
            h('div', { class: 'flex items-center justify-between gap-3' }, [
              h(
                Link,
                { to: `/post/${post.value.id}` },
                {
                  default: () =>
                    h(
                      'span',
                      {
                        class:
                          'font-medium text-blue-600 no-underline hover:underline dark:text-blue-200',
                      },
                      post.value?.title,
                    ),
                },
              ),
              h('span', { class: 'text-xs text-muted-foreground' }, `${post.value.likes} likes`),
            ]),
            h('div', { class: 'flex flex-wrap items-center gap-2' }, [
              h(
                'span',
                { class: 'text-xs text-muted-foreground' },
                author.value?.name ? `by ${author.value.name}` : 'By an anonymous collaborator',
              ),
              ...(post.value.tags?.items ?? []).map(({ node }) =>
                h(TagBadge, { key: node.id, tag: node }),
              ),
            ]),
          ])
        : null;
  },
});
</script>

<template>
  <Card v-if="category" :key="category.id">
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-3">
        <div>
          <Link :to="`/category/${category.id}`">
            <H3>{{ category.name }}</H3>
          </Link>
          <p class="text-sm text-muted-foreground">{{ category.description }}</p>
        </div>
        <Badge class="text-nowrap" variant="outline">{{ category.postCount }} posts</Badge>
      </div>
      <div class="flex flex-col gap-3">
        <CategoryPost v-for="{ node } in category.posts?.items ?? []" :key="node.id" :post="node" />
      </div>
      <span v-if="category.posts?.pagination?.hasNext" class="text-sm text-muted-foreground">
        More posts available in this category...
      </span>
    </div>
  </Card>
</template>
