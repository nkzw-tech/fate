/**
 * @vitest-environment happy-dom
 */

import { args, createClient, selectionFromView, v, view } from '@nkzw/fate';
import { act, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { FateClient } from '../context.tsx';
import { useListView } from '../useListView.tsx';
import { useView } from '../useView.tsx';

// @ts-expect-error React global
global.IS_REACT_ACT_ENVIRONMENT = true;

type Comment = { __typename: 'Comment'; content: string; id: string };

type Post = {
  __typename: 'Post';
  comments: Array<Comment>;
  id: string;
};

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
    transport: {
      fetchById,
    },
    types: [
      { fields: { comments: { listOf: 'Comment' } }, type: 'Post' },
      { type: 'Comment' },
    ],
  });

  const CommentView = view<Comment>()({
    content: true,
    id: true,
  });

  const PostView = view<Post>()({
    comments: {
      args: args({ first: v('first', 1) }),
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
    },
    id: true,
  });

  const plan = selectionFromView(PostView, null, { first: 1 });

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
    const [comments, loadNext] = useListView(CommentView, post.comments);
    renders.push(
      comments.map(({ node }) => (node?.id ? String(node.id) : null)),
    );

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
    new Set(['comments', 'comments.content', 'comments.id']),
  );

  expect(loadNextRef).toBeNull();
  expect(renders.at(-1)).toEqual(['comment-1', 'comment-2']);
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
    transport: {
      fetchById,
    },
    types: [
      { fields: { comments: { listOf: 'Comment' } }, type: 'Post' },
      { type: 'Comment' },
    ],
  });

  const CommentView = view<Comment>()({
    content: true,
    id: true,
  });

  const PostView = view<Post>()({
    comments: {
      args: args({ first: v('first', 1) }),
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
    },
    id: true,
  });

  const plan = selectionFromView(PostView, null, { first: 1 });

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
    const [comments, , loadPrevious] = useListView(CommentView, post.comments);

    useEffect(() => {
      loadPreviousRef = loadPrevious;
    }, [loadPrevious]);

    renders.push(
      comments.map(({ node }) => (node?.id ? String(node.id) : null)),
    );
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
    new Set(['comments', 'comments.content', 'comments.id']),
  );

  expect(loadPreviousRef).toBeNull();
  expect(renders.at(-1)).toEqual(['comment-0', 'comment-1']);
});
