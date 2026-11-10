import {
  clientSchema,
  memo,
  createClient,
  dataView,
  field,
  list,
  view,
  type EntityOf,
} from '@nkzw/fate';
import { createIndexedDBStorage } from '@nkzw/fate-indexeddb';
import { createPersistence } from '@nkzw/fate/persistence';
import { z } from 'zod';

type TaskData = { done: boolean; id: string; title: string };
type WorkspaceData = { id: string; tasks: Array<TaskData> };
const task = dataView<TaskData>('Task')({ done: true, id: true, title: true });
const workspace = dataView<WorkspaceData>('Workspace')({
  id: true,
  progress: memo({
    resolve: (_item: WorkspaceData, { done = [] }) =>
      `${done.filter(Boolean).length} of ${done.length} complete`,
    select: { done: field('tasks.done') },
  }),
  tasks: list(task),
});
const schema = clientSchema({
  roots: { workspace: { id: 'main', type: 'Workspace' } },
  types: {
    Task: { defaults: (id) => ({ done: false, id, title: '' }), view: task },
    Workspace: {
      defaults: (id) => ({
        id,
        tasks: [{ done: false, id: 'welcome', title: 'Add your first task' }],
      }),
      view: workspace,
    },
  },
});

const createTaskClient = () =>
  createClient({
    persistence: createPersistence({ key: 'tasks', storage: createIndexedDBStorage() }),
  }).registerClientSchema(schema, (builder) => ({
    'task.add': builder.mutation('Task', {
      input: z.object({ title: z.string().trim().min(1) }),
      resolve: ({ input, store }) => {
        const task = store.create('Task', { id: crypto.randomUUID(), title: input.title });
        store.update('Workspace', 'main', {
          tasks: [...(store.get('Workspace', 'main')?.tasks ?? []), task],
        });
        return task;
      },
    }),
    'task.remove': builder.mutation('Task', {
      input: z.object({ id: z.string() }),
      resolve: ({ input, store }) => store.delete('Task', input.id),
    }),
    'task.toggle': builder.mutation('Task', {
      input: z.object({ id: z.string() }),
      resolve: ({ input, store }) =>
        store.update('Task', input.id, { done: !store.get('Task', input.id)?.done }),
    }),
  }));

type TaskClient = ReturnType<typeof createTaskClient>;
let client: TaskClient | undefined;
export const getTaskClient = () => (client ??= createTaskClient());

export const WorkspaceView = view<EntityOf<TaskClient, 'Workspace'>>()({
  progress: true,
  tasks: { done: true, id: true, title: true },
});

declare module '@nkzw/fate' {
  interface ClientRegistration {
    client: TaskClient;
  }
}
