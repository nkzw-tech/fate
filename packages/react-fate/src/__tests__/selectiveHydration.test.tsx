/**
 * @vitest-environment happy-dom
 */

import { clientRoot, clientValueRoot, createClient, defer, view } from '@nkzw/fate';
import { act, Suspense, use, useEffect, type ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { expect, test, vi } from 'vite-plus/test';
import { FateClient, useListView, useRequest, useView, useViews } from '../index.tsx';

// @ts-expect-error React act environment flag.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Comment = { __typename: 'Comment'; id: string; text: string };
type Post = { __typename: 'Post'; comments: Array<Comment>; id: string; title: string };

const CommentView = view<Comment>()({ id: true, text: true });
const commentsView = { items: { node: CommentView } };
const PostView = view<Post>()({ comments: defer(commentsView), id: true, title: true });
const request = { post: { id: 'post', view: PostView } };
const roots = { post: clientRoot('Post') };
const types = [
  { fields: { comments: { listOf: 'Comment' }, title: 'scalar' }, type: 'Post' },
  { fields: { text: 'scalar' }, type: 'Comment' },
] as const;

const postData = (title: string, comment: string) => ({
  __typename: 'Post',
  comments: [{ __typename: 'Comment', id: comment, text: comment }],
  id: 'post',
  title,
});

const writePost = (client: ReturnType<typeof createClient>, title: string, comment: string) =>
  client.write(
    'Post',
    postData(title, comment),
    new Set(['id', 'title', 'comments.id', 'comments.text']),
  );

function Preview({ onHydrate }: { onHydrate?: () => void }) {
  const { post } = useRequest(request);
  const { comments, title } = useView(PostView, post);
  const [items] = useListView(commentsView, comments);
  const rows = useViews(
    CommentView,
    items.map(({ node }) => node),
  );
  useEffect(() => onHydrate?.(), [onHydrate]);
  return (
    <p>
      {title}: {rows.map(({ text }) => text).join(', ')}
    </p>
  );
}

function Delay({ children, ready }: { children: ReactNode; ready?: Promise<void> }) {
  if (ready) {
    use(ready);
  }
  return children;
}

test('hydrates an empty view without a cached entity', async () => {
  const EmptyPostView = view<Post>()({});
  const request = { post: { id: 'missing', view: EmptyPostView } };
  const fetchById = vi.fn();
  const server = createClient({ roots, transport: { fetchById }, types });
  await server.request(request);
  const snapshot = server.dehydrate();
  const browser = createClient({ roots, transport: { fetchById }, types });
  browser.hydrate(snapshot);

  function Title() {
    const { post } = useRequest(request);
    return <p>{useView(EmptyPostView, post).__typename}</p>;
  }

  const container = document.createElement('div');
  container.innerHTML = renderToString(
    <FateClient client={server}>
      <Title />
    </FateClient>,
  );
  const original = container.querySelector('p');
  expect(original?.textContent).toBe('Post');
  const onRecoverableError = vi.fn();
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(
        container,
        <FateClient client={browser} hydrationState={snapshot}>
          <Title />
        </FateClient>,
        { onRecoverableError },
      );
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.querySelector('p')).toBe(original);
    expect(fetchById).not.toHaveBeenCalled();
  } finally {
    await act(async () => root?.unmount());
  }
});

test('hydrates a delayed boundary against the original data and then reads live updates', async () => {
  const server = createClient({ roots, types });
  writePost(server, 'Original', 'First');
  await server.request(request);
  const snapshot = server.dehydrate();
  const html = renderToString(
    <FateClient client={server}>
      <button type="button">Update post</button>
      <Suspense fallback={null}>
        <Preview />
      </Suspense>
    </FateClient>,
  );
  const fetchById = vi.fn(async () => [postData('Unexpected', 'Unexpected')]);
  const browser = createClient({ roots, transport: { fetchById }, types });
  browser.hydrate(snapshot);
  const ready = Promise.withResolvers<void>();
  const onHydrate = vi.fn();
  const onRecoverableError = vi.fn();
  const container = document.createElement('div');
  container.innerHTML = html;
  const original = container.querySelector('p');
  expect(original?.textContent).toBe('Original: First');
  const update = vi.fn(() => writePost(browser, 'Edited', 'Second'));

  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(
        container,
        <FateClient client={browser} hydrationState={snapshot}>
          <button onClick={update} type="button">
            Update post
          </button>
          <Suspense fallback={null}>
            <Delay ready={ready.promise}>
              <Preview onHydrate={onHydrate} />
            </Delay>
          </Suspense>
        </FateClient>,
        { onRecoverableError },
      );
    });

    await act(async () => container.querySelector('button')!.click());
    expect(update).toHaveBeenCalledOnce();
    expect(onHydrate).not.toHaveBeenCalled();
    expect(original?.textContent).toBe('Original: First');

    await act(async () => ready.resolve());
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(onHydrate).toHaveBeenCalledOnce();
    expect(container.querySelector('p')).toBe(original);
    expect(original?.textContent).toBe('Edited: Second');
    expect(fetchById).not.toHaveBeenCalled();
  } finally {
    await act(async () => root?.unmount());
  }
});

test('uses the snapshot of an explicit client under a different provider', async () => {
  const server = createClient({ roots, types });
  writePost(server, 'Original', 'First');
  const snapshot = server.dehydrate();
  const browser = createClient({ roots, types });
  browser.hydrate(snapshot);
  writePost(browser, 'Edited', 'Second');
  const otherClient = createClient();
  const readTitle = (client: typeof browser) => {
    function Title() {
      const ref = client.ref<Post>('Post', 'post', PostView);
      return <p>{useView(PostView, ref, { client }).title}</p>;
    }
    return (
      <FateClient client={otherClient}>
        <Title />
      </FateClient>
    );
  };
  const container = document.createElement('div');
  container.innerHTML = renderToString(
    <FateClient client={server}>{readTitle(server)}</FateClient>,
  );
  const original = container.querySelector('p');
  const onRecoverableError = vi.fn();
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(
        container,
        <FateClient client={browser} hydrationState={snapshot}>
          {readTitle(browser)}
        </FateClient>,
        { onRecoverableError },
      );
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.querySelector('p')).toBe(original);
    expect(original?.textContent).toBe('Edited');
  } finally {
    await act(async () => root?.unmount());
  }
});

test('keeps the server result visible during a network-only refresh after hydration', async () => {
  const roots = { title: clientValueRoot<string>() };
  const request = { title: { value: true } } as const;
  const fetchById = vi.fn();
  const server = createClient({
    roots,
    transport: { fetchById, fetchQuery: async () => 'Original' },
  });
  await server.request(request);
  const snapshot = server.dehydrate();
  const pending = Promise.withResolvers<string>();
  const fetchQuery = vi.fn(() => pending.promise);
  const browser = createClient({ roots, transport: { fetchById, fetchQuery } });
  browser.hydrate(snapshot);
  const onCommit = vi.fn();
  function Title() {
    const { title } = useRequest(request, { mode: 'network-only' });
    useEffect(onCommit, []);
    return <p>{title}</p>;
  }
  const app = (
    <Suspense fallback="Refreshing">
      <Title />
    </Suspense>
  );
  const container = document.createElement('div');
  container.innerHTML = renderToString(
    <FateClient client={server} hydrationState={snapshot}>
      {app}
    </FateClient>,
  );
  const original = container.querySelector('p');
  const onRecoverableError = vi.fn();
  fetchQuery.mockImplementation(() => {
    expect(onCommit).toHaveBeenCalledOnce();
    return pending.promise;
  });
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(
        container,
        <FateClient client={browser} hydrationState={snapshot}>
          {app}
        </FateClient>,
        { onRecoverableError },
      );
    });
    expect(fetchQuery).toHaveBeenCalledOnce();
    expect(container.textContent).toBe('Original');
    await act(async () => pending.resolve('Updated'));
    expect(container.querySelector('p')).toBe(original);
    expect(container.textContent).toBe('Updated');
    expect(onRecoverableError).not.toHaveBeenCalled();
  } finally {
    await act(async () => root?.unmount());
  }
});
