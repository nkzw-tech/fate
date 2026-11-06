<script setup lang="ts">
import { ref } from 'vue';
import { useFateClient, useRequest, useView } from 'vue-fate';
import { WorkspaceView } from '../src/state.ts';

const fate = useFateClient();
const request = useRequest({ workspace: { view: WorkspaceView } });
const state = useView(WorkspaceView, () => request.data.value?.workspace);
const title = ref('');
const pending = ref(false);
const error = ref('');
await request.ready();
await state.ready();

const run = async (mutate: () => Promise<{ error?: Error }>) => {
  pending.value = true;
  error.value = '';
  try {
    const result = await mutate();
    if (result.error) {
      error.value = result.error.message;
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    pending.value = false;
  }
};

const add = () => {
  if (title.value.trim()) {
    void run(async () => {
      const result = await fate.mutations.task.add({ input: { title: title.value } });
      if (!result.error) {
        title.value = '';
      }
      return result;
    });
  }
};
</script>

<template>
  <h1>Tasks</h1>
  <p>{{ state?.progress }}</p>
  <form @submit.prevent="add">
    <input v-model="title" aria-label="Task title" required />
    <button :disabled="pending" type="submit">Add task</button>
  </form>
  <p v-if="error" role="alert">{{ error }}</p>
  <ul>
    <li v-for="task in state?.tasks" :key="task.id">
      <label>
        <input
          :checked="task.done"
          :disabled="pending"
          type="checkbox"
          @change="run(() => fate.mutations.task.toggle({ input: { id: task.id } }))"
        />
        {{ task.title }}
      </label>
      <button
        :aria-label="`Remove ${task.title}`"
        :disabled="pending"
        type="button"
        @click="run(() => fate.mutations.task.remove({ input: { id: task.id } }))"
      >
        Remove
      </button>
    </li>
  </ul>
</template>
