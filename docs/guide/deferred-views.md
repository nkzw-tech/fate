# Deferred Views

Let's say a post's comments take longer to load than its title and content. Wrap `comments` in `defer` so the post can render first, and give the comments their own `Suspense` boundary:

```tsx
import { Suspense } from 'react';
import { defer, useListView, useView, view, Deferred, ViewRef } from 'react-fate';

const CommentView = view<Comment>()({
  content: true,
  id: true,
});

const CommentConnectionView = {
  args: { first: 3 },
  items: { node: CommentView },
};

const PostView = view<Post>()({
  comments: defer(CommentConnectionView),
  content: true,
  id: true,
  title: true,
});

function PostCard({ post: postRef }: { post: ViewRef<'Post'> }) {
  const post = useView(PostView, postRef);

  return (
    <article>
      <h2>{post.title}</h2>
      <p>{post.content}</p>
      <Suspense fallback={<CommentsSkeleton />}>
        <PostComments comments={post.comments} />
      </Suspense>
    </article>
  );
}

function PostComments({
  comments,
}: {
  comments: Deferred<{ items: ReadonlyArray<{ node: ViewRef<'Comment'> }> }>;
}) {
  const [items, loadNext] = useListView(CommentConnectionView, comments);

  return (
    <section>
      {items.map(({ node }) => (
        <CommentCard comment={node} key={node.id} />
      ))}
      {loadNext ? <button onClick={loadNext}>Load more</button> : null}
    </section>
  );
}
```

`title` and `content` are available when `useView(PostView, postRef)` returns. Reading the comments with `useListView` loads any missing data and suspends only `PostComments`.

`useView` and `useLiveListView` can read deferred values too. This works with every transport. GraphQL currently fetches deferred fields with separate queries, rather than streaming `@defer` responses.
