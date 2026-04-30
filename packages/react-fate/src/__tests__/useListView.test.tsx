/**
 * @vitest-environment happy-dom
 */

import {
  createClient,
  FateMutations,
  getSelectionPlan,
  clientRoot,
  mutation,
  view,
} from '@nkzw/fate';
import { act, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';
import { FateClient } from '../context.tsx';
import { useListView } from '../useListView.tsx';
import { useRequest } from '../useRequest.tsx';
import { useView } from '../useView.tsx';

// @ts-expect-error React global
global.IS_REACT_ACT_ENVIRONMENT = true;

type Comment = { __typename: 'Comment'; content: string; id: string };

type Post = {
  __typename: 'Post';
  comments: Array<Comment>;
  id: string;
};

const flushAsync = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('loads additional items when loadNext is invoked', async () => {
  const fetchById = vi.fn().mockResolvedValue([
    {
      __typename: 'Post',
      comments: {
        items: [
          {
            cursor: 'cursor-2',
            node: {
              __typename: 'Comment',
              content: 'Banana',
              id: 'comment-2',
            },
          },
        ],
        pagination: {
          hasNext: false,
          hasPrevious: true,
          previousCursor: 'cursor-1',
        },
      },
      id: 'post-1',
    },
  ]);

  const client = createClient({
    roots: {},
    transport: {
      fetchById,
    },
    types: [{ fields: { comments: { listOf: 'Comment' } }, type: 'Post' }, { type: 'Comment' }],
  });

  const CommentView = view<Comment>()({
    content: true,
    id: true,
  });

  const CommentConnectionView = {
    args: { first: 1 },
    items: {
      cursor: true,
      node: CommentView,
    },
    pagination: {
      hasNext: true,
      hasPrevious: true,
      nextCursor: true,
      previousCursor: true,
    },
  } as const;

  const PostView = view<Post>()({
    comments: CommentConnectionView,
    id: true,
  });

  const plan = getSelectionPlan(PostView, null);

  client.write(
    'Comment',
    {
      __typename: 'Comment',
      content: 'Apple',
      id: 'comment-1',
    },
    new Set(['__typename', 'content', 'id']),
  );

  client.write(
    'Post',
    {
      __typename: 'Post',
      comments: {
        items: [
          {
            cursor: 'cursor-1',
            node: {
              __typename: 'Comment',
              content: 'Apple',
              id: 'comment-1',
            },
          },
        ],
        pagination: {
          hasNext: true,
          hasPrevious: false,
          nextCursor: 'cursor-1',
        },
      },
      id: 'post-1',
    },
    plan.paths,
    undefined,
    plan,
  );

  const postRef = client.ref<Post>('Post', 'post-1', PostView);

  const renders: Array<Array<string | null>> = [];
  let loadNextRef: (() => Promise<void>) | null = null;

  const Component = () => {
    const post = useView(PostView, postRef);
    const [comments, loadNext] = useListView(CommentConnectionView, post.comments);
    renders.push(comments.map(({ node }) => (node?.id ? String(node.id) : null)));

    useEffect(() => {
      loadNextRef = loadNext;
    }, [loadNext]);

    return (
      <button
        onClick={async () => {
          await loadNext?.();
        }}
      >
        load
      </button>
    );
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

  expect(container.textContent).toBe('load');
  expect(renders.at(-1)).toEqual(['comment-1']);

  await act(async () => {
    await loadNextRef?.();
  });

  expect(fetchById).toHaveBeenCalledWith(
    'Post',
    ['post-1'],
    new Set(['comments.content', 'comments.id']),
    expect.objectContaining({ comments: expect.objectContaining({ after: 'cursor-1', first: 1 }) }),
  );

  expect(loadNextRef).toBeNull();
  expect(renders.at(-1)).toEqual(['comment-1', 'comment-2']);
});

test('loadNext forwards the limit when the initial request used last/before', async () => {
  const fetchById = vi.fn().mockResolvedValue([
    {
      __typename: 'Post',
      comments: {
        items: [
          {
            cursor: 'cursor-2',
            node: {
              __typename: 'Comment',
              content: 'Banana',
              id: 'comment-2',
            },
          },
        ],
        pagination: {
          hasNext: false,
          hasPrevious: true,
          previousCursor: 'cursor-1',
        },
      },
      id: 'post-1',
    },
  ]);

  const client = createClient({
    roots: {},
    transport: {
      fetchById,
    },
    types: [{ fields: { comments: { listOf: 'Comment' } }, type: 'Post' }, { type: 'Comment' }],
  });

  const CommentView = view<Comment>()({
    content: true,
    id: true,
  });

  const CommentConnectionView = {
    args: { last: 1 },
    items: {
      cursor: true,
      node: CommentView,
    },
    pagination: {
      hasNext: true,
      hasPrevious: true,
      nextCursor: true,
      previousCursor: true,
    },
  } as const;

  const PostView = view<Post>()({
    comments: CommentConnectionView,
    id: true,
  });

  const plan = getSelectionPlan(PostView, null);

  client.write(
    'Comment',
    {
      __typename: 'Comment',
      content: 'Apple',
      id: 'comment-1',
    },
    new Set(['__typename', 'content', 'id']),
  );

  client.write(
    'Post',
    {
      __typename: 'Post',
      comments: {
        items: [
          {
            cursor: 'cursor-1',
            node: {
              __typename: 'Comment',
              content: 'Apple',
              id: 'comment-1',
            },
          },
        ],
        pagination: {
          hasNext: true,
          hasPrevious: false,
          nextCursor: 'cursor-1',
        },
      },
      id: 'post-1',
    },
    plan.paths,
    undefined,
    plan,
  );

  const postRef = client.ref<Post>('Post', 'post-1', PostView);

  const renders: Array<Array<string | null>> = [];
  let loadNextRef: (() => Promise<void>) | null = null;

  const Component = () => {
    const post = useView(PostView, postRef);
    const [comments, loadNext] = useListView(CommentConnectionView, post.comments);
    renders.push(comments.map(({ node }) => (node?.id ? String(node.id) : null)));

    useEffect(() => {
      loadNextRef = loadNext;
    }, [loadNext]);

    return (
      <button
        onClick={async () => {
          await loadNext?.();
        }}
      >
        load
      </button>
    );
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

  expect(container.textContent).toBe('load');
  expect(renders.at(-1)).toEqual(['comment-1']);

  await act(async () => {
    await loadNextRef?.();
  });

  expect(fetchById).toHaveBeenCalledWith(
    'Post',
    ['post-1'],
    new Set(['comments.content', 'comments.id']),
    expect.objectContaining({ comments: expect.objectContaining({ after: 'cursor-1', first: 1 }) }),
  );

  expect(loadNextRef).toBeNull();
  expect(renders.at(-1)).toEqual(['comment-1', 'comment-2']);
});

test('uses pagination from list state when not selected', async () => {
  const fetchById = vi.fn().mockResolvedValue([
    {
      __typename: 'Post',
      comments: {
        items: [
          {
            cursor: 'cursor-2',
            node: {
              __typename: 'Comment',
              content: 'Banana',
              id: 'comment-2',
            },
          },
        ],
        pagination: {
          hasNext: false,
          hasPrevious: true,
          previousCursor: 'cursor-1',
        },
      },
      id: 'post-1',
    },
  ]);

  const client = createClient({
    roots: {},
    transport: {
      fetchById,
    },
    types: [{ fields: { comments: { listOf: 'Comment' } }, type: 'Post' }, { type: 'Comment' }],
  });

  const CommentView = view<Comment>()({
    content: true,
    id: true,
  });

  const CommentConnectionView = {
    args: { first: 1 },
    items: {
      node: CommentView,
    },
  } as const;

  const PostView = view<Post>()({
    comments: CommentConnectionView,
    id: true,
  });

  const plan = getSelectionPlan(PostView, null);

  client.write(
    'Comment',
    {
      __typename: 'Comment',
      content: 'Apple',
      id: 'comment-1',
    },
    new Set(['__typename', 'content', 'id']),
  );

  client.write(
    'Post',
    {
      __typename: 'Post',
      comments: {
        items: [
          {
            cursor: 'cursor-1',
            node: {
              __typename: 'Comment',
              content: 'Apple',
              id: 'comment-1',
            },
          },
        ],
        pagination: {
          hasNext: true,
          hasPrevious: false,
          nextCursor: 'cursor-1',
        },
      },
      id: 'post-1',
    },
    plan.paths,
    undefined,
    plan,
  );

  const postRef = client.ref<Post>('Post', 'post-1', PostView);

  const renders: Array<Array<string | null>> = [];
  let loadNextRef: (() => Promise<void>) | null = null;

  const Component = () => {
    const post = useView(PostView, postRef);
    const [comments, loadNext] = useListView(CommentConnectionView, post.comments);
    renders.push(comments.map(({ node }) => (node?.id ? String(node.id) : null)));

    useEffect(() => {
      loadNextRef = loadNext;
    }, [loadNext]);

    return null;
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

  expect(loadNextRef).not.toBeNull();
  expect(renders.at(-1)).toEqual(['comment-1']);

  await act(async () => {
    await loadNextRef?.();
  });

  expect(fetchById).toHaveBeenCalledWith(
    'Post',
    ['post-1'],
    new Set(['comments.content', 'comments.id']),
    { comments: { after: 'cursor-1', first: 1, id: 'post-1' } },
  );

  expect(loadNextRef).toBeNull();
  expect(renders.at(-1)).toEqual(['comment-1', 'comment-2']);
});

test('updates root list items after loading the next page', async () => {
  type Project = { __typename: 'Project'; id: string; name: string };

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

  const renders: Array<Array<string | null>> = [];
  let loadNextRef: (() => Promise<void>) | null = null;

  const Component = () => {
    const { projects } = useRequest<typeof request, typeof roots>(request);
    const [projectList, loadNext] = useListView(ProjectConnectionView, projects);

    renders.push(projectList.map(({ node }) => (node ? String(node.id) : null)));

    useEffect(() => {
      loadNextRef = loadNext;
    }, [loadNext]);

    return null;
  };

  const container = document.createElement('div');
  const reactRoot = createRoot(container);

  await act(async () => {
    reactRoot.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );

    await flushAsync();
  });

  expect(loadNextRef).not.toBeNull();
  expect(renders.at(-1)).toEqual(['project-1']);

  await act(async () => {
    await loadNextRef?.();
  });

  expect(fetchList).toHaveBeenLastCalledWith('projects', new Set(['id', 'name']), {
    after: 'cursor-1',
    first: 3,
  });

  expect(renders.at(-1)).toEqual(['project-1', 'project-2']);
});

test('root list optimistic pending edges roll back after failed mutations', async () => {
  type Project = { __typename: 'Project'; id: string; name: string };

  const roots = {
    projects: clientRoot('Project'),
  };
  const mutations = {
    createProject: mutation<Project, { name: string }, Project>('Project'),
  };
  const fetchList = vi.fn().mockResolvedValue({
    items: [
      {
        cursor: 'cursor-1',
        node: { __typename: 'Project', id: 'project-1', name: 'Project 1' },
      },
    ],
    pagination: { hasNext: true, hasPrevious: false, nextCursor: 'cursor-1' },
  });
  let rejectMutation: ((error: Error) => void) | undefined;
  const mutate = vi.fn(
    (_key, _input, _select) =>
      new Promise<Project>((_resolve, reject) => {
        rejectMutation = reject;
      }),
  ) as NonNullable<
    Parameters<typeof createClient<[typeof roots, typeof mutations]>>[0]['transport']['mutate']
  >;
  const client = createClient<[typeof roots, typeof mutations]>({
    mutations,
    roots,
    transport: {
      async fetchById() {
        return [];
      },
      fetchList,
      mutate,
    },
    types: [{ fields: { name: 'scalar' }, type: 'Project' }],
  });

  const ProjectView = view<Project>()({ id: true, name: true });
  const ProjectConnectionView = {
    items: {
      cursor: true,
      node: ProjectView,
    },
    pagination: { hasNext: true, nextCursor: true },
  } as const;

  const request = {
    projects: {
      list: ProjectConnectionView,
    },
  };

  const renders: Array<Array<string | null>> = [];

  const Component = () => {
    const { projects } = useRequest<typeof request, typeof roots>(request);
    const [projectList] = useListView(ProjectConnectionView, projects);

    renders.push(projectList.map(({ node }) => (node ? String(node.id) : null)));

    return null;
  };

  const container = document.createElement('div');
  const reactRoot = createRoot(container);

  await act(async () => {
    reactRoot.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );

    await flushAsync();
  });

  expect(renders.at(-1)).toEqual(['project-1']);

  let mutationPromise: ReturnType<(typeof client.mutations)['createProject']> | undefined;

  await act(async () => {
    mutationPromise = client.mutations.createProject({
      input: { name: 'Draft' },
      optimistic: {
        id: 'optimistic:project-2',
        name: 'Draft',
      },
      view: ProjectView,
    });

    await flushAsync();
  });

  expect(renders.at(-1)).toEqual(['project-1', 'optimistic:project-2']);

  await act(async () => {
    rejectMutation?.(new Error('Not signed in.'));
    await expect(mutationPromise).rejects.toThrow('Not signed in.');
    await flushAsync();
  });

  expect(renders.at(-1)).toEqual(['project-1']);
});

test('nested list optimistic pending edges roll back after failed mutations', async () => {
  type CommentWithPost = Comment & { post?: { id: string } | null };
  type PostWithComments = {
    __typename: 'Post';
    comments: Array<CommentWithPost>;
    id: string;
  };
  type CreateCommentInput = { content: string; postId: string };

  const mutations = {
    addComment: mutation<CommentWithPost, CreateCommentInput, CommentWithPost>('Comment'),
  };
  let rejectMutation: ((error: Error) => void) | undefined;
  const mutate = vi.fn(
    (_key, _input, _select) =>
      new Promise<CommentWithPost>((_resolve, reject) => {
        rejectMutation = reject;
      }),
  ) as NonNullable<
    Parameters<
      typeof createClient<[Record<string, never>, typeof mutations]>
    >[0]['transport']['mutate']
  >;
  const client = createClient<[Record<string, never>, typeof mutations]>({
    mutations,
    roots: {},
    transport: {
      async fetchById() {
        return [];
      },
      mutate,
    },
    types: [
      { fields: { comments: { listOf: 'Comment' } }, type: 'Post' },
      { fields: { post: { type: 'Post' } }, type: 'Comment' },
    ],
  });

  const CommentView = view<CommentWithPost>()({
    content: true,
    id: true,
    post: { id: true },
  });
  const CommentConnectionView = {
    args: { first: 1 },
    items: {
      cursor: true,
      node: CommentView,
    },
    pagination: { hasNext: true, hasPrevious: true, nextCursor: true },
  } as const;
  const PostView = view<PostWithComments>()({
    comments: CommentConnectionView,
    id: true,
  });
  const plan = getSelectionPlan(PostView, null);

  client.write(
    'Post',
    {
      __typename: 'Post',
      comments: {
        items: [
          {
            cursor: 'cursor-1',
            node: {
              __typename: 'Comment',
              content: 'Comment 1',
              id: 'comment-1',
            },
          },
        ],
        pagination: { hasNext: true, hasPrevious: false, nextCursor: 'cursor-1' },
      },
      id: 'post-1',
    },
    plan.paths,
    undefined,
    plan,
  );

  const postRef = client.ref<PostWithComments>('Post', 'post-1', PostView);
  const renders: Array<Array<string | null>> = [];

  const Component = () => {
    const post = useView(PostView, postRef);
    const [comments] = useListView(CommentConnectionView, post.comments);

    renders.push(comments.map(({ node }) => (node ? String(node.id) : null)));

    return null;
  };

  const container = document.createElement('div');
  const reactRoot = createRoot(container);

  await act(async () => {
    reactRoot.render(
      <FateClient client={client}>
        <Suspense fallback={null}>
          <Component />
        </Suspense>
      </FateClient>,
    );

    await flushAsync();
  });

  expect(renders.at(-1)).toEqual(['comment-1']);

  let mutationPromise: ReturnType<(typeof client.mutations)['addComment']> | undefined;

  await act(async () => {
    mutationPromise = client.mutations.addComment({
      input: { content: 'Draft', postId: 'post-1' },
      optimistic: {
        content: 'Draft',
        id: 'optimistic:comment-2',
        post: { id: 'post-1' },
      },
      view: CommentView,
    });

    await flushAsync();
  });

  expect(renders.at(-1)).toEqual(['comment-1', 'optimistic:comment-2']);

  await act(async () => {
    rejectMutation?.(new Error('Not signed in.'));
    await expect(mutationPromise).rejects.toThrow('Not signed in.');
    await flushAsync();
  });

  expect(renders.at(-1)).toEqual(['comment-1']);
});

test('loads previous items when loadPrevious is invoked', async () => {
  const fetchById = vi.fn().mockResolvedValue([
    {
      __typename: 'Post',
      comments: {
        items: [
          {
            cursor: 'cursor-0',
            node: {
              __typename: 'Comment',
              content: 'Apple',
              id: 'comment-0',
            },
          },
        ],
        pagination: {
          hasNext: true,
          hasPrevious: false,
          nextCursor: 'cursor-1',
        },
      },
      id: 'post-1',
    },
  ]);

  const client = createClient({
    roots: {},
    transport: {
      fetchById,
    },
    types: [{ fields: { comments: { listOf: 'Comment' } }, type: 'Post' }, { type: 'Comment' }],
  });

  const CommentView = view<Comment>()({
    content: true,
    id: true,
  });

  const CommentConnectionView = {
    args: { first: 1 },
    items: {
      cursor: true,
      node: CommentView,
    },
    pagination: {
      hasNext: true,
      hasPrevious: true,
      nextCursor: true,
      previousCursor: true,
    },
  } as const;

  const PostView = view<Post>()({
    comments: CommentConnectionView,
    id: true,
  });

  const plan = getSelectionPlan(PostView, null);

  client.write(
    'Comment',
    {
      __typename: 'Comment',
      content: 'Banana',
      id: 'comment-1',
    },
    new Set(['__typename', 'content', 'id']),
  );

  client.write(
    'Post',
    {
      __typename: 'Post',
      comments: {
        items: [
          {
            cursor: 'cursor-1',
            node: {
              __typename: 'Comment',
              content: 'Banana',
              id: 'comment-1',
            },
          },
        ],
        pagination: {
          hasNext: false,
          hasPrevious: true,
          previousCursor: 'cursor-1',
        },
      },
      id: 'post-1',
    },
    plan.paths,
    undefined,
    plan,
  );

  const postRef = client.ref<Post>('Post', 'post-1', PostView);

  const renders: Array<Array<string | null>> = [];
  let loadPreviousRef: (() => Promise<void>) | null = null;

  const Component = () => {
    const post = useView(PostView, postRef);
    const [comments, , loadPrevious] = useListView(CommentConnectionView, post.comments);

    useEffect(() => {
      loadPreviousRef = loadPrevious;
    }, [loadPrevious]);

    renders.push(comments.map(({ node }) => (node?.id ? String(node.id) : null)));
    return null;
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

  expect(renders.at(-1)).toEqual(['comment-1']);

  await act(async () => {
    await loadPreviousRef?.();
  });

  expect(fetchById).toHaveBeenCalledWith(
    'Post',
    ['post-1'],
    new Set(['comments.content', 'comments.id']),
    { comments: { before: 'cursor-1', id: 'post-1', last: 1 } },
  );

  expect(loadPreviousRef).toBeNull();
  expect(renders.at(-1)).toEqual(['comment-0', 'comment-1']);
});
