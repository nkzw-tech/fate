/**
 * @vitest-environment happy-dom
 */

// preact-iso's boundaries only re-render themselves once a thrown promise
// settles, so suspended fate hooks have to schedule their own retry.
import { clientRoot, createClient, view } from '@nkzw/fate';
import { ErrorBoundary, LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { expect, test, vi } from 'vite-plus/test';
import { FateClient, Suspense, useRequest, useView } from '../index.ts';
import { act, createRoot } from './preact.ts';

type Post = { __typename: 'Post'; content: string; id: string };
const PostView = view<Post>()({ content: true, id: true });
const roots = { post: clientRoot('Post') };

const setup = () => {
  const pending = new Map<string, PromiseWithResolvers<Array<Post>>>();
  const fetchById = vi.fn((_type: string, ids: ReadonlyArray<string | number>) => {
    const deferred = Promise.withResolvers<Array<Post>>();
    pending.set(String(ids[0]), deferred);
    return deferred.promise;
  });
  const client = createClient<[typeof roots, Record<never, never>]>({
    roots,
    transport: { fetchById },
    types: [{ type: 'Post' }],
  });
  const settle = (id: string) =>
    act(async () => {
      pending.get(id)!.resolve([{ __typename: 'Post', content: `Post ${id}`, id }]);
    });
  return { client, settle };
};

function PostScreen({ id }: { id: string }) {
  const request = { post: { id, view: PostView } };
  const { post } = useRequest<typeof request, typeof roots>(request);
  return <span>{useView(PostView, post).content}</span>;
}

const PostRoute = ({ params }: { params: { id: string } }) => <PostScreen id={params.id} />;
const NotFound = () => <span>not found</span>;

test('renders once data is ready inside preact-iso’s ErrorBoundary', async () => {
  const { client, settle } = setup();
  const container = document.createElement('div');
  const root = createRoot(container);

  await act(async () =>
    root.render(
      <FateClient client={client}>
        <ErrorBoundary>
          <main>
            <PostScreen id="1" />
          </main>
        </ErrorBoundary>
      </FateClient>,
    ),
  );
  expect(container.textContent).toBe('');

  await settle('1');
  expect(container.textContent).toBe('Post 1');
  await act(async () => root.unmount());
});

test('preact-iso’s Router keeps the previous route while the next one loads', async () => {
  const { client, settle } = setup();
  history.replaceState(null, '', '/post/1');
  let navigate!: (url: string) => void;
  function Navigator() {
    navigate = useLocation().route;
    return null;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <FateClient client={client}>
        <LocationProvider>
          <Navigator />
          <Suspense fallback="loading">
            <Router>
              <Route component={PostRoute} path="/post/:id" />
              <Route component={NotFound} default />
            </Router>
          </Suspense>
        </LocationProvider>
      </FateClient>,
    ),
  );
  await settle('1');
  expect(container.textContent).toBe('Post 1');

  await act(async () => navigate('/post/2'));
  expect(container.textContent).toBe('Post 1');

  await settle('2');
  expect(container.textContent).toBe('Post 2');

  await act(async () => navigate('/post/1'));
  expect(container.textContent).toBe('Post 1');
  await act(async () => root.unmount());
});
