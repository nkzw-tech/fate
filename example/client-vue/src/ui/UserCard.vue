<script setup lang="ts">
import safeParse from '@nkzw/core/safeParse.js';
import { computed, ref, watch } from 'vue';
import type { ViewRef } from 'vue-fate';
import { useFateClient, useView } from 'vue-fate';
import { UserCardView, UserView } from '../fateViews.ts';
import AuthClient from '../user/AuthClient.ts';
import Button from './Button.vue';
import Card from './Card.vue';
import H2 from './H2.vue';
import Input from './Input.vue';

const props = defineProps<{
  viewer: ViewRef<'User'>;
}>();

const fate = useFateClient();
const viewer = useView(UserCardView, () => props.viewer);
const name = ref('');
const error = ref<string | null>(null);
const isPending = ref(false);

watch(
  () => viewer.value?.name,
  (nextName) => {
    name.value = nextName ?? '';
  },
  { immediate: true },
);

const trimmedName = computed(() => name.value.trim());
const originalName = computed(() => viewer.value?.name ?? '');
const isSaveDisabled = computed(
  () =>
    !viewer.value?.id ||
    !trimmedName.value ||
    trimmedName.value === originalName.value ||
    isPending.value,
);

const submit = async () => {
  if (!viewer.value?.id || isSaveDisabled.value) {
    return;
  }

  const newName = trimmedName.value;
  name.value = newName;
  isPending.value = true;

  try {
    error.value = null;
    await fate.mutations.user.update({
      input: { name: newName },
      optimistic: {
        id: viewer.value.id,
        username: newName,
      },
      view: UserView,
    });
    await AuthClient.updateUser({ name: newName });
  } catch (caughtError) {
    error.value =
      (caughtError instanceof Error &&
        caughtError.message &&
        safeParse<Array<{ message: string }>>(caughtError.message)?.[0]?.message) ||
      'Failed to update user name.';
  } finally {
    isPending.value = false;
  }
};
</script>

<template>
  <Card v-if="viewer">
    <div class="flex h-full flex-col justify-between gap-4">
      <div class="flex flex-col gap-4">
        <H2>Your account</H2>
        <div class="flex items-center justify-between gap-4">
          <p class="text-sm text-muted-foreground">
            Signed in as {{ viewer.name }}{{ viewer.email ? ` <${viewer.email}>` : '' }}.
          </p>
        </div>
      </div>
      <form class="flex flex-col gap-3" @submit.prevent="submit">
        <h3 class="font-semibold">Update Name</h3>
        <label class="sr-only" for="header-username">Username</label>
        <Input
          id="header-username"
          v-model="name"
          :aria-describedby="error ? 'header-username-error' : undefined"
          :aria-invalid="error ? 'true' : undefined"
          class="w-48"
          :disabled="isPending"
          name="name"
          placeholder="Name"
          :title="error ?? undefined"
        />
        <div>
          <Button :disabled="isSaveDisabled" size="sm" type="submit" variant="secondary">
            Save
          </Button>
        </div>
        <span v-if="error" id="header-username-error">{{ error }}</span>
      </form>
    </div>
  </Card>
</template>
