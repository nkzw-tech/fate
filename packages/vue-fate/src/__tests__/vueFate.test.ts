/**
 * @vitest-environment happy-dom
 */

import { readFileSync } from 'node:fs';
import {
  ConnectionTag,
  clientRoot,
  createClient,
  defer,
  toEntityId,
  view,
  type ConnectionMetadata,
  type Deferred,
  type FateMutations,
  type ViewRef,
} from '@nkzw/fate';
import { expect, test, vi } from 'vite-plus/test';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import type { ShallowRef } from 'vue';
import {
  FateClient,
  useFateClient,
  useListView,
  useLiveListView,
  useLiveView,
  useRequest,
  useView,
} from '../index.ts';

type User = { __typename: 'User'; id: string; name: string };
type Post = {
  __typename: 'Post';
  author: User | null;
  content: string;
  id: string;
};
type PostWithComments = Post & { comments: Array<Comment> };
type Project = { __typename: 'Project'; id: string; name: string };
type Comment = { __typename: 'Comment'; id: string };
type ErrorResource = {
  error: ShallowRef<unknown>;
  pending: ShallowRef<boolean>;
};

const expectDefined = <T>(value: T): NonNullable<T> => {
  expect(value).not.toBeNull();
  return value as NonNullable<T>;
};

const flushAsync = async () => {
  await nextTick();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await nextTick();
};

const mount = (
  component: ReturnType<typeof defineComponent>,
  client: ReturnType<typeof createClient>,
) => {
  const container = document.createElement('div');
  const app = createApp({
    render: () =>
      h(
        FateClient,
        { client },
        {
          default: () => h(component),
        },
      ),
  });
  app.mount(container);
  return { app, container };
};

test('provides the fate client through Vue injection', () => {
  const client = createClient({
    roots: {},
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [],
  });

  const Component = defineComponent({
    setup() {
      const injected = useFateClient();
      return () => h('span', injected.roots === client.roots ? 'injected' : 'missing');
    },
  });

  const { container } = mount(Component, client);

  expect(container.textContent).toBe('injected');
});

test('keeps the provided fate client prop reactive', async () => {
  const clientA = createClient({
    roots: {
      post: clientRoot('Post'),
    },
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [{ type: 'Post' }],
  });
  const clientB = createClient({
    roots: {
      project: clientRoot('Project'),
    },
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [{ type: 'Project' }],
  });
  const currentClient = ref<ReturnType<typeof createClient>>(clientA);
  const container = document.createElement('div');
  const Component = defineComponent({
    setup() {
      const injected = useFateClient();
      return () => h('span', 'project' in injected.roots ? 'project' : 'post');
    },
  });
  const app = createApp({
    render: () =>
      h(FateClient, { client: currentClient.value } as any, {
        default: () => h(Component),
      }),
  });

  app.mount(container);
  expect(container.textContent).toBe('post');

  currentClient.value = clientB;
  await nextTick();

  expect(container.textContent).toBe('project');
  app.unmount();
});

test('retains cache-first requests while mounted and disposes them on unmount', async () => {
  const fetchById = vi.fn().mockResolvedValue([
    {
      __typename: 'Post',
      content: 'Apple',
      id: 'post-1',
    },
  ]);

  const client = createClient({
    gcReleaseBufferSize: 0,
    roots: {
      post: clientRoot('Post'),
    },
    transport: { fetchById },
    types: [{ fields: { content: 'scalar' }, type: 'Post' }],
  });

  const PostView = view<Post>()({
    content: true,
    id: true,
  });
  const request = { post: { id: 'post-1', view: PostView } };
  const postId = toEntityId('Post', 'post-1');

  const Component = defineComponent({
    setup() {
      useRequest(request);
      return () => h('span', 'Post');
    },
  });

  const { app } = mount(Component, client);
  await flushAsync();

  expect(client.store.read(postId)).toMatchObject({ content: 'Apple' });

  app.unmount();
  await flushAsync();

  expect(client.store.read(postId)).toBeUndefined();
});

test('releases network-only requests on unmount', async () => {
  const fetchById = vi.fn().mockResolvedValue([
    {
      __typename: 'Post',
      id: 'post-1',
    },
  ]);

  const client = createClient({
    roots: {
      post: clientRoot('Post'),
    },
    transport: { fetchById },
    types: [{ type: 'Post' }],
  });

  const PostView = view<Post>()({
    id: true,
  });
  const request = { post: { ids: ['post-1'], view: PostView } };
  const requestKey = client.getRequestKey(request);
  const releaseSpy = vi.spyOn(client, 'releaseRequestKey');

  const Component = defineComponent({
    setup() {
      useRequest(request, { mode: 'network-only' });
      return () => h('span', 'Post');
    },
  });

  const { app } = mount(Component, client);
  await flushAsync();

  expect(fetchById).toHaveBeenCalledTimes(1);
  expect(releaseSpy).not.toHaveBeenCalled();

  app.unmount();
  await flushAsync();

  expect(releaseSpy).toHaveBeenCalledWith(requestKey, 'network-only');
});

test('stores rejected request errors on the resource', async () => {
  const requestError = new Error('request failed');
  const fetchById = vi.fn().mockRejectedValue(requestError);
  const roots = {
    post: clientRoot('Post'),
  };
  const client = createClient<[typeof roots, FateMutations]>({
    roots,
    transport: { fetchById },
    types: [{ fields: { content: 'scalar' }, type: 'Post' }],
  });
  const PostView = view<Post>()({ content: true, id: true });
  const request = { post: { id: 'post-1', view: PostView } };
  type RequestErrorResource = ErrorResource & {
    data: ShallowRef<unknown>;
  };
  let resource: RequestErrorResource | null = null;

  const Component = defineComponent({
    setup() {
      const requestResource = useRequest<typeof request, typeof roots>(request);
      void requestResource.ready().catch(() => {});
      resource = requestResource;
      return () => h('span', requestResource.pending.value ? 'pending' : 'settled');
    },
  });

  mount(Component, client);
  await flushAsync();

  const currentResource = expectDefined(resource as RequestErrorResource | null);
  expect(currentResource.error.value).toBe(requestError);
  expect(currentResource.pending.value).toBe(false);
  expect(currentResource.data.value).toBeNull();
});

test('stores rejected view errors on the resource', async () => {
  const viewError = new Error('view failed');
  const client = createClient({
    roots: {},
    transport: {
      fetchById: vi.fn().mockRejectedValue(viewError),
    },
    types: [{ fields: { content: 'scalar' }, type: 'Post' }],
  });
  const PostView = view<Post>()({ content: true, id: true });
  const postRef = client.ref<Post>('Post', 'post-1', PostView);
  type ViewErrorResource = ErrorResource & {
    value: unknown;
  };
  let resource: ViewErrorResource | null = null;

  const Component = defineComponent({
    setup() {
      const viewResource = useView(PostView, postRef);
      void viewResource.ready().catch(() => {});
      resource = viewResource;
      return () => h('span', viewResource.pending.value ? 'pending' : 'settled');
    },
  });

  mount(Component, client);
  await flushAsync();

  const currentResource = expectDefined(resource as ViewErrorResource | null);
  expect(currentResource.error.value).toBe(viewError);
  expect(currentResource.pending.value).toBe(false);
  expect(currentResource.value).toBeNull();
});

test('stores rejected deferred list errors on the resource', async () => {
  const listError = new Error('deferred list failed');
  const client = createClient({
    roots: {},
    transport: {
      fetchById: vi.fn().mockRejectedValue(listError),
    },
    types: [{ fields: { comments: { listOf: 'Comment' } }, type: 'Post' }, { type: 'Comment' }],
  });

  client.write('Post', { __typename: 'Post', id: 'post-1' }, new Set(['id']));

  const CommentView = view<Comment>()({ id: true });
  const CommentConnectionView = { items: { node: CommentView } } as const;
  const PostView = view<PostWithComments>()({
    comments: defer(CommentConnectionView),
    id: true,
  });
  const postSnapshot = await Promise.resolve(
    client.readView(PostView, client.ref<PostWithComments>('Post', 'post-1', PostView)),
  );
  const comments = (
    postSnapshot.data as unknown as {
      comments: Deferred<{
        items: ReadonlyArray<{ node: ViewRef<'Comment'> }>;
      }>;
    }
  ).comments;
  let resource: ErrorResource | null = null;

  const Component = defineComponent({
    setup() {
      const listResource = useListView(CommentConnectionView, comments);
      void listResource.ready().catch(() => {});
      resource = listResource;
      return () => h('span', listResource.pending.value ? 'pending' : 'settled');
    },
  });

  mount(Component, client);
  await flushAsync();

  const currentResource = expectDefined(resource as ErrorResource | null);
  expect(currentResource.error.value).toBe(listError);
  expect(currentResource.pending.value).toBe(false);
});

test('updates when nested entities change', async () => {
  const client = createClient({
    roots: {},
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [
      {
        fields: { author: { type: 'User' } },
        type: 'Post',
      },
      { type: 'User' },
    ],
  });

  client.write(
    'Post',
    {
      __typename: 'Post',
      author: {
        __typename: 'User',
        id: 'user-1',
        name: 'Apple',
      },
      content: 'Kiwi',
      id: 'post-1',
    },
    new Set(['id', 'content', 'author.id', 'author.name']),
  );

  const PostView = view<Post>()({
    author: {
      id: true,
      name: true,
    },
    content: true,
    id: true,
  });
  const postRef = client.ref<Post>('Post', 'post-1', PostView);
  const renders: Array<string | null | undefined> = [];

  const Component = defineComponent({
    setup() {
      const post = useView(PostView, postRef);
      return () => {
        const name = post.value?.author ? post.value.author.name : null;
        renders.push(name);
        return h('span', name ?? '');
      };
    },
  });

  const { container } = mount(Component, client);
  await flushAsync();

  expect(container.textContent).toBe('Apple');

  client.write(
    'User',
    {
      __typename: 'User',
      id: 'user-1',
      name: 'Banana',
    },
    new Set(['id', 'name']),
  );
  await flushAsync();

  expect(container.textContent).toBe('Banana');
  expect(renders.filter(Boolean)[0]).toBe('Apple');
  expect(renders.at(-1)).toBe('Banana');
});

test('only updates components that match the selection', async () => {
  const client = createClient({
    roots: {},
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [{ type: 'Post' }],
  });

  client.write(
    'Post',
    {
      __typename: 'Post',
      content: 'Kiwi',
      id: 'post-1',
    },
    new Set(['id', 'content']),
  );

  const PostAView = view<Post>()({
    content: true,
    id: true,
  });
  const PostBView = view<Post>()({
    id: true,
  });
  const postARef = client.ref<Post>('Post', 'post-1', PostAView);
  const postBRef = client.ref<Post>('Post', 'post-1', PostBView);
  let renders: Array<string> = [];

  const ComponentA = defineComponent({
    setup() {
      const postA = useView(PostAView, postARef);
      return () => {
        renders.push('renderA');
        return h('span', postA.value?.content);
      };
    },
  });

  const ComponentB = defineComponent({
    setup() {
      const postB = useView(PostBView, postBRef);

      return () => {
        renders.push('renderB');
        return h('span', postB.value?.id);
      };
    },
  });

  const Component = defineComponent({
    render: () => h('span', [h(ComponentA), ' ', h(ComponentB)]),
  });

  const { container } = mount(Component, client);
  await flushAsync();

  expect(container.textContent).toBe('Kiwi post-1');
  renders = [];
  client.write(
    'Post',
    {
      __typename: 'Post',
      content: 'Banana',
      id: 'post-1',
    },
    new Set(['content']),
  );
  await flushAsync();

  expect(container.textContent).toBe('Banana post-1');
  expect(renders).toEqual(['renderA']);
});

test('subscribes to list pagination and exposes load-more helpers', async () => {
  const fetchList = vi
    .fn()
    .mockResolvedValueOnce({
      items: [
        { cursor: 'cursor-1', node: { __typename: 'Project', id: 'project-1', name: 'Alpha' } },
      ],
      pagination: { hasNext: true, nextCursor: 'cursor-1' },
    })
    .mockResolvedValueOnce({
      items: [
        { cursor: 'cursor-2', node: { __typename: 'Project', id: 'project-2', name: 'Beta' } },
      ],
      pagination: { hasNext: false },
    });

  const roots = {
    projects: clientRoot('Project'),
  };
  const client = createClient<[typeof roots, FateMutations]>({
    roots,
    transport: {
      async fetchById() {
        return [];
      },
      fetchList,
    },
    types: [{ fields: { name: 'scalar' }, type: 'Project' }],
  });

  const ProjectView = view<Project>()({ id: true, name: true });
  const ProjectConnectionView = {
    args: { first: 3 },
    items: {
      cursor: true,
      node: ProjectView,
    },
    pagination: { hasNext: true, nextCursor: true },
  } as const;
  const request = {
    projects: {
      args: { first: 1 },
      list: ProjectConnectionView,
    },
  };
  let loadNextRef = null as ShallowRef<(() => Promise<void>) | null> | null;

  const Component = defineComponent({
    setup() {
      const requestResource = useRequest<typeof request, typeof roots>(request);
      const [projects, loadNext] = useListView(
        ProjectConnectionView,
        () => requestResource.data.value?.projects,
      );
      loadNextRef = loadNext;

      return () =>
        h('span', projects.value.map(({ node }) => (node as ViewRef<'Project'>).id).join(','));
    },
  });

  const { container } = mount(Component, client);
  await flushAsync();

  expect(container.textContent).toBe('project-1');
  expect((loadNextRef as ShallowRef<(() => Promise<void>) | null> | null)?.value).not.toBeNull();

  await (loadNextRef as ShallowRef<(() => Promise<void>) | null> | null)?.value?.();
  await flushAsync();

  expect(container.textContent).toBe('project-1,project-2');
  expect((loadNextRef as ShallowRef<(() => Promise<void>) | null> | null)?.value).toBeNull();
});

test('stores missing live-view support errors on the resource', async () => {
  const client = createClient({
    roots: {},
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [{ fields: { content: 'scalar' }, type: 'Post' }],
  });

  client.write(
    'Post',
    {
      __typename: 'Post',
      content: 'Apple',
      id: 'post-1',
    },
    new Set(['content', 'id']),
  );

  const PostView = view<Post>()({ content: true, id: true });
  const postRef = client.ref<Post>('Post', 'post-1', PostView);
  let resource: ErrorResource | null = null;

  const Component = defineComponent({
    setup() {
      const liveResource = useLiveView(PostView, postRef);
      resource = liveResource;
      return () => h('span', liveResource.value?.content);
    },
  });

  const { container } = mount(Component, client);
  await flushAsync();

  expect(container.textContent).toBe('Apple');
  const currentResource = expectDefined(resource as ErrorResource | null);
  expect((currentResource.error.value as Error).message).toContain('live views');
  expect(currentResource.pending.value).toBe(false);
});

test('stores missing live-list support errors on the resource', async () => {
  const client = createClient({
    roots: {},
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [{ fields: { name: 'scalar' }, type: 'Project' }],
  });
  const ProjectView = view<Project>()({ id: true, name: true });
  const ProjectConnectionView = { items: { node: ProjectView } } as const;
  const projects = {
    items: [],
    pagination: {
      hasNext: false,
      hasPrevious: false,
    },
  };
  Object.defineProperty(projects, ConnectionTag, {
    value: {
      field: 'projects',
      key: 'projects',
      owner: 'projects',
      procedure: 'projects',
      root: true,
      type: 'Project',
    } satisfies ConnectionMetadata,
  });
  let resource: ErrorResource | null = null;

  const Component = defineComponent({
    setup() {
      const listResource = useLiveListView(ProjectConnectionView, projects);
      resource = listResource;
      return () => h('span', listResource[0].value.length);
    },
  });

  const { container } = mount(Component, client);
  await flushAsync();

  expect(container.textContent).toBe('0');
  const currentResource = expectDefined(resource as ErrorResource | null);
  expect((currentResource.error.value as Error).message).toContain('live list views');
  expect(currentResource.pending.value).toBe(false);
});

test('manual dispose releases live-view subscriptions', async () => {
  const unsubscribe = vi.fn();
  const subscribeById = vi.fn(() => unsubscribe);
  const client = createClient({
    roots: {},
    transport: {
      async fetchById() {
        return [];
      },
      subscribeById,
    } as any,
    types: [{ fields: { content: 'scalar' }, type: 'Post' }],
  });

  client.write(
    'Post',
    {
      __typename: 'Post',
      content: 'Apple',
      id: 'post-1',
    },
    new Set(['content', 'id']),
  );

  const PostView = view<Post>()({ content: true, id: true });
  const postRef = client.ref<Post>('Post', 'post-1', PostView);
  let resource: { dispose: () => void } | null = null;

  const Component = defineComponent({
    setup() {
      const liveResource = useLiveView(PostView, postRef);
      resource = liveResource;
      return () => h('span', liveResource.value?.content);
    },
  });

  mount(Component, client);
  await flushAsync();

  expect(subscribeById).toHaveBeenCalledTimes(1);

  expectDefined(resource as { dispose: () => void } | null).dispose();
  await flushAsync();

  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test('manual dispose releases live-list subscriptions', async () => {
  const unsubscribe = vi.fn();
  const subscribeConnection = vi.fn(() => unsubscribe);
  const client = createClient({
    roots: {},
    transport: {
      async fetchById() {
        return [];
      },
      subscribeConnection,
    } as any,
    types: [{ fields: { name: 'scalar' }, type: 'Project' }],
  });
  const ProjectView = view<Project>()({ id: true, name: true });
  const ProjectConnectionView = { items: { node: ProjectView } } as const;
  const projects = {
    items: [],
    pagination: {
      hasNext: false,
      hasPrevious: false,
    },
  };
  Object.defineProperty(projects, ConnectionTag, {
    value: {
      field: 'projects',
      key: 'projects',
      owner: 'projects',
      procedure: 'projects',
      root: true,
      type: 'Project',
    } satisfies ConnectionMetadata,
  });
  let resource: { dispose: () => void } | null = null;

  const Component = defineComponent({
    setup() {
      const listResource = useLiveListView(ProjectConnectionView, projects);
      resource = listResource;
      return () => h('span', listResource[0].value.length);
    },
  });

  mount(Component, client);
  await flushAsync();

  expect(subscribeConnection).toHaveBeenCalledTimes(1);

  expectDefined(resource as { dispose: () => void } | null).dispose();
  await flushAsync();

  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test('exposes the fate CLI bin from the Vue package', () => {
  const packageJson = JSON.parse(readFileSync('packages/vue-fate/package.json', 'utf8')) as {
    bin?: Record<string, string>;
    scripts?: Record<string, string>;
  };

  expect(packageJson.bin).toEqual({ fate: './lib/cli.mjs' });
  expect(packageJson.scripts?.build).toContain('src/cli.ts');
});
