/**
 * @vitest-environment happy-dom
 */

import { createClient, mutation, view, type Transport } from '@nkzw/fate';
import { act, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { FateClient } from '../context.tsx';
import { useView } from '../useView.tsx';

// @ts-expect-error React 🤷‍♂️
global.IS_REACT_ACT_ENVIRONMENT = true;

type User = { __typename: 'User'; id: string; name: string };

type Post = {
  __typename: 'Post';
  author: User | null;
  content: string;
  id: string;
};

const flushAsync = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('updates when nested entities change', () => {
  const client = createClient({
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

  const userSelection = new Set(['id', 'name']);
  const postSelection = new Set(['id', 'content', 'author.id', 'author.name']);

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
    postSelection,
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

  const Component = () => {
    const post = useView(PostView, postRef);
    const name = post.author ? post.author.name : null;
    renders.push(name);
    return <span>{name}</span>;
  };

  const container = document.createElement('div');
  const root = createRoot(container);

  act(() => {
    root.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );
  });

  expect(container.textContent).toBe('Apple');

  act(() => {
    client.write(
      'User',
      {
        __typename: 'User',
        id: 'user-1',
        name: 'Banana',
      },
      userSelection,
    );
  });

  expect(container.textContent).toBe('Banana');
  expect(renders[0]).toBe('Apple');
  expect(renders.at(-1)).toBe('Banana');
});

test('only updates components that match the selection', () => {
  const client = createClient({
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [{ type: 'Post' }],
  });

  const postSelection = new Set(['id', 'content']);

  client.write(
    'Post',
    {
      __typename: 'Post',
      content: 'Kiwi',
      id: 'post-1',
    },
    postSelection,
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

  let renders: Array<string | null | undefined> = [];

  const ComponentA = () => {
    const post = useView(PostAView, postARef);
    renders.push('renderA');
    return <span>{post.content}</span>;
  };

  const ComponentB = () => {
    const post = useView(PostBView, postBRef);
    renders.push('renderB');
    return <span>{post.id}</span>;
  };

  const container = document.createElement('div');
  const root = createRoot(container);

  act(() => {
    root.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <ComponentA /> <ComponentB />
        </Suspense>
      </FateClient>,
    );
  });

  expect(container.textContent).toBe('Kiwi post-1');
  expect(renders).toMatchInlineSnapshot(`
    [
      "renderA",
      "renderB",
    ]
  `);

  renders = [];

  act(() => {
    client.write(
      'Post',
      {
        __typename: 'Post',
        content: 'Banana',
        id: 'post-1',
      },
      new Set(['content']),
    );
  });

  expect(container.textContent).toBe('Banana post-1');
  expect(renders).toMatchInlineSnapshot(`
    [
      "renderA",
      "renderA",
    ]
  `);
});

test('re-renders when a mutation updates the record', async () => {
  type UpdatePostInput = { content: string; id: string };
  type UpdateMutations = {
    updatePost: { input: UpdatePostInput; output: Post };
  };

  const { promise, resolve } = Promise.withResolvers<Post>();
  const mutate: NonNullable<Transport<UpdateMutations>['mutate']> = vi.fn(
    () => promise,
  );

  const client = createClient({
    mutations: {
      updatePost: mutation<Post, UpdatePostInput, Post>('Post'),
    },
    transport: {
      async fetchById() {
        return [];
      },
      mutate,
    },
    types: [
      { fields: { author: { type: 'User' } }, type: 'Post' },
      { type: 'User' },
    ],
  });

  const userSelection = new Set(['id', 'name']);
  const postSelection = new Set(['id', 'content', 'author.id', 'author.name']);

  client.write(
    'User',
    {
      __typename: 'User',
      id: 'user-1',
      name: 'Apple',
    },
    userSelection,
  );

  client.write(
    'Post',
    {
      __typename: 'Post',
      author: {
        __typename: 'User',
        id: 'user-1',
        name: 'Apple',
      },
      content: 'Draft',
      id: 'post-1',
    },
    postSelection,
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

  const renders: Array<string> = [];

  const Component = () => {
    const post = useView(PostView, postRef);
    renders.push(post.content);
    return <span>{post.content}</span>;
  };

  const container = document.createElement('div');
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );
  });

  expect(container.textContent).toBe('Draft');

  let pendingMutation: Promise<{ result: Post } | { error: Error }>;
  await act(async () => {
    pendingMutation = client.mutations.updatePost({
      input: { content: 'Published', id: 'post-1' },
      optimisticUpdate: {
        author: {
          __typename: 'User',
          id: 'user-1',
          name: 'Apple',
        },
        content: 'Optimistic',
        id: 'post-1',
      },
      view: PostView,
    });
    await flushAsync();
  });
  expect(container.textContent).toBe('Optimistic');

  resolve({
    __typename: 'Post',
    author: {
      __typename: 'User',
      id: 'user-1',
      name: 'Apple',
    },
    content: 'Published',
    id: 'post-1',
  });

  await act(async () => {
    await pendingMutation;
  });

  expect(container.textContent).toBe('Published');
  expect(renders).toEqual([
    'Draft',
    'Draft',
    'Optimistic',
    'Optimistic',
    'Published',
  ]);
  expect(mutate).toHaveBeenCalledTimes(1);
});

test('rolls back optimistic updates when a mutation fails', async () => {
  type UpdatePostInput = { content: string; id: string };
  type UpdatePostResult = Post;
  type FailedUpdateMutations = {
    updatePost: { input: UpdatePostInput; output: UpdatePostResult };
  };

  const { promise, reject } = Promise.withResolvers<UpdatePostResult>();
  const mutate: NonNullable<Transport<FailedUpdateMutations>['mutate']> = vi.fn(
    () => promise,
  );

  const client = createClient({
    mutations: {
      updatePost: mutation<Post, UpdatePostInput, UpdatePostResult>('Post'),
    },
    transport: {
      async fetchById() {
        return [];
      },
      mutate,
    },
    types: [
      { fields: { author: { type: 'User' } }, type: 'Post' },
      { type: 'User' },
    ],
  });

  const userSelection = new Set(['id', 'name']);
  const postSelection = new Set(['id', 'content', 'author.id', 'author.name']);

  client.write(
    'User',
    {
      __typename: 'User',
      id: 'user-1',
      name: 'Apple',
    },
    userSelection,
  );

  client.write(
    'Post',
    {
      __typename: 'Post',
      author: {
        __typename: 'User',
        id: 'user-1',
        name: 'Apple',
      },
      content: 'Draft',
      id: 'post-1',
    },
    postSelection,
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

  const renders: Array<string> = [];

  const Component = () => {
    const post = useView(PostView, postRef);
    renders.push(post.content);
    return <span>{post.content}</span>;
  };

  const container = document.createElement('div');
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );
  });

  expect(container.textContent).toBe('Draft');

  let pendingMutation: Promise<{ result: UpdatePostResult } | { error: Error }>;
  await act(async () => {
    pendingMutation = client.mutations.updatePost({
      input: { content: 'Published', id: 'post-1' },
      optimisticUpdate: {
        author: {
          __typename: 'User',
          id: 'user-1',
          name: 'Apple',
        },
        content: 'Optimistic',
        id: 'post-1',
      },
      view: PostView,
    });
    await flushAsync();
  });
  expect(container.textContent).toBe('Optimistic');

  reject(new Error('Mutation failed'));

  await act(async () => {
    await expect(pendingMutation).rejects.toThrow('Mutation failed');
  });

  expect(container.textContent).toBe('Draft');
  expect(renders).toEqual([
    'Draft',
    'Draft',
    'Optimistic',
    'Optimistic',
    'Draft',
  ]);
  expect(mutate).toHaveBeenCalledTimes(1);
});

test('throws when using a view ref that does not include the view', () => {
  const client = createClient({
    transport: {
      async fetchById() {
        return [];
      },
    },
    types: [{ type: 'Post' }],
  });

  const AnotherPostView = view<Post>()({
    content: true,
  });

  const PostDetailView = view<Post>()({
    content: true,
    id: true,
  });

  const postRef = client.ref<Post>('Post', 'post-1', AnotherPostView);

  const Component = () => {
    useView(PostDetailView, postRef);
    return null;
  };

  const container = document.createElement('div');
  const root = createRoot(container);

  expect(() => {
    act(() => {
      root.render(
        <FateClient client={client}>
          <Suspense fallback={null}>
            <Component />
          </Suspense>
        </FateClient>,
      );
    });
  }).toThrowError(/Invalid view reference/);
});
