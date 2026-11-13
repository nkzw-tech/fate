import { clientRoot, createClient, view } from '@nkzw/fate';
import { Suspense, use, useEffect } from 'react';
import { useFateClient, useRequest, useView } from 'react-fate';

type Post = { __typename: 'Post'; id: string; title: string };
const PostView = view<Post>()({ id: true, title: true });
export const request = { post: { id: 'hello', view: PostView } };

export const createFixtureClient = () =>
  createClient({
    roots: { post: clientRoot('Post') },
    types: [{ fields: { title: 'scalar' }, type: 'Post' }],
  });

export function writeTitle(client: ReturnType<typeof createFixtureClient>, title: string) {
  client.write('Post', { __typename: 'Post', id: 'hello', title }, new Set(['id', 'title']));
}

function useTitle() {
  const { post } = useRequest(request);
  return useView(PostView, post).title;
}

type PreviewName = 'A' | 'B';

function Editor() {
  const client = useFateClient();
  const title = useTitle();
  return (
    <>
      <p id="live-title">{title}</p>
      <button onClick={() => writeTitle(client, 'Edited in the browser')} type="button">
        Edit title
      </button>
    </>
  );
}

function Preview({
  name,
  onHydrated,
  ready,
}: {
  name: PreviewName;
  onHydrated?: (name: PreviewName) => void;
  ready?: Promise<void>;
}) {
  if (ready) {
    use(ready);
  }
  const title = useTitle();
  useEffect(() => onHydrated?.(name), [name, onHydrated]);
  return (
    <section aria-label={`Preview ${name}`} tabIndex={0}>
      <h2>Preview {name}</h2>
      <p>{title}</p>
    </section>
  );
}

export function App({
  onPreviewHydrated,
  onRelease,
  previewsReady,
}: {
  onPreviewHydrated?: (name: PreviewName) => void;
  onRelease?: () => void;
  previewsReady?: Promise<void>;
}) {
  return (
    <>
      <Editor />
      <button onClick={onRelease} type="button">
        Resolve previews
      </button>
      {(['A', 'B'] as const).map((name) => (
        <Suspense fallback={null} key={name}>
          <Preview name={name} onHydrated={onPreviewHydrated} ready={previewsReady} />
        </Suspense>
      ))}
    </>
  );
}
