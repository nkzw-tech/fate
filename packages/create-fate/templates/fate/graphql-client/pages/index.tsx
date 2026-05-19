import { ConnectionRef, useListView, useRequest } from 'react-fate';
import { postDataView, userDataView } from '../src/fate/graphql.ts';

const PostConnectionView = {
  args: { first: 10 },
  items: {
    node: postDataView,
  },
  pagination: {
    hasNext: true,
  },
};

const PostList = ({ posts: postsRef }: { posts: ConnectionRef<'Post'> }) => {
  const [posts] = useListView(PostConnectionView, postsRef);

  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-semibold">Posts</h2>
      {posts.map(({ node }) => (
        <article
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          key={node.id}
        >
          <h3 className="text-lg font-semibold">{node.title}</h3>
          {node.author ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {node.author.name ?? node.author.username ?? node.author.id}
            </p>
          ) : null}
        </article>
      ))}
    </section>
  );
};

export default function HomePage() {
  const { posts, viewer } = useRequest({
    posts: { list: PostConnectionView },
    viewer: { view: userDataView },
  });

  return (
    <main className="mx-auto min-h-screen max-w-4xl space-y-8 px-6 py-16">
      <header className="space-y-3">
        <p className="text-sm font-semibold tracking-wide text-blue-600 uppercase dark:text-blue-400">
          fate + GraphQL
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-white">
          Use fate with an existing GraphQL server
        </h1>
        <p className="max-w-2xl text-slate-600 dark:text-slate-300">
          Replace the sample views in <code>src/fate/graphql.ts</code> with your schema types and
          point <code>VITE_GRAPHQL_URL</code> at your API.
        </p>
      </header>

      {viewer ? (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400">Viewer</h2>
          <p className="mt-2 text-lg font-semibold">
            {viewer.name ?? viewer.username ?? viewer.id}
          </p>
        </section>
      ) : null}
      <PostList posts={posts} />
    </main>
  );
}
