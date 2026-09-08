import { ConnectionRef, useListView, useRequest, useView, view, ViewRef } from 'react-fate';
import type { Post, User } from '../src/fate/graphql.ts';

const UserView = view<User>()({
  id: true,
  name: true,
  username: true,
});

const PostView = view<Post>()({
  author: UserView,
  title: true,
});

const PostConnectionView = {
  args: { first: 10 },
  items: {
    node: PostView,
  },
  pagination: {
    hasNext: true,
  },
};

const UserName = ({ user: userRef }: { user: ViewRef<'User'> }) => {
  const user = useView(UserView, userRef);

  return user.name ?? user.username ?? user.id;
};

const PostItem = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  const post = useView(PostView, postRef);

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-lg font-semibold">{post.title}</h3>
      {post.author ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          <UserName user={post.author} />
        </p>
      ) : null}
    </article>
  );
};

const Viewer = ({ viewer: viewerRef }: { viewer: ViewRef<'User'> }) => {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400">
        <fbt desc="index: Viewer">Viewer</fbt>
      </h2>
      <p className="mt-2 text-lg font-semibold">
        <UserName user={viewerRef} />
      </p>
    </section>
  );
};

const PostList = ({ posts: postsRef }: { posts: ConnectionRef<'Post'> }) => {
  const [posts] = useListView(PostConnectionView, postsRef);

  return (
    <section className="space-y-4">
      <h2 className="text-2xl font-semibold">
        <fbt desc="index: Posts">Posts</fbt>
      </h2>
      {posts.map(({ node }) => (
        <PostItem key={node.id} post={node} />
      ))}
    </section>
  );
};

export default function HomePage() {
  const { posts, viewer } = useRequest({
    posts: { list: PostConnectionView },
    viewer: { view: UserView },
  });

  return (
    <main className="mx-auto min-h-screen max-w-4xl space-y-8 px-6 py-16">
      <header className="space-y-3">
        <p className="text-sm font-semibold tracking-wide text-blue-600 uppercase dark:text-blue-400">
          fate + GraphQL
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-white">
          <fbt desc="index: Use fate with an existing GraphQL server">
            Use fate with an existing GraphQL server
          </fbt>{' '}
        </h1>
        <p className="max-w-2xl text-slate-600 dark:text-slate-300">
          <fbt desc="GraphQL client setup instructions">
            Replace the sample views in <code>src/fate/graphql.ts</code> with your schema types and
            point <code>VITE_GRAPHQL_URL</code> at your API.
          </fbt>
        </p>
      </header>

      {viewer ? <Viewer viewer={viewer} /> : null}
      <PostList posts={posts} />
    </main>
  );
}
