# Actions

fate does not provide hooks for mutations like traditional data fetching libraries do. Instead, mutations are exposed in two ways:

- `fate.actions` for use with [`useActionState`](https://react.dev/reference/react/useActionState) and React Actions.
- `fate.mutations` for traditional imperative mutation calls.

fate's Vite plugin makes your server mutations available on the client. The API works the same way with native HTTP, tRPC, GraphQL, and Void.

If you have a mutation named `post.like`, a `LikeButton` component using fate Actions and an async component library could look like this:

```tsx
import { useActionState } from 'react';
import { useFateClient } from 'react-fate';

const LikeButton = ({ post }: { post: { id: string; likes: number } }) => {
  const fate = useFateClient();
  const [result, like] = useActionState(fate.actions.post.like, null);

  return (
    <Button action={() => like({ input: { id: post.id } })}>
      {result?.error ? 'Oops!' : 'Like'}
    </Button>
  );
};
```

If you are not using an async component library, you can use React's `useTransition` to start the action in a transition:

```tsx
const LikeButton = ({ post }: { post: { id: string; likes: number } }) => {
  const fate = useFateClient();
  const [, startTransition] = useTransition();
  const [result, like, isPending] = useActionState(fate.actions.post.like, null);

  return (
    <button
      disabled={isPending}
      onClick={() => {
        startTransition(() =>
          like({
            input: { id: post.id },
          }),
        );
      }}
    >
      {result?.error ? 'Oops!' : 'Like'}
    </button>
  );
};
```

## Optimistic Updates

To update the like count before the server responds, pass an `optimistic` object:

```tsx
like({
  input: { id: post.id },
  optimistic: { likes: post.likes + 1 },
});
```

Views that select `likes` update immediately. Views that only select other fields, such as `title`, do not re-render. If the mutation fails, fate rolls back the optimistic update.

## Inserting New Objects

Let's add a comment to a post. Pass the comments list as `insert.into` and give the optimistic comment a temporary ID:

```tsx
const content = 'New Comment text';
addComment({
  input: { content, postId: post.id },
  insert: { into: post.comments, position: 'after' },
  optimistic: {
    author: { id: user.id, name: user.name },
    content,
    id: `optimistic:${Date.now().toString(36)}`,
    post: { commentCount: post.commentCount + 1, id: post.id },
  },
});
```

The comment appears immediately. When the server responds, fate replaces the temporary ID with the real one. If the mutation fails, the comment disappears and the count is restored.

Use `position: 'before'` for a newest-first list. Without `insert`, fate updates existing records but does not add them to lists. See [Controlling List Insertion Behavior](#controlling-list-insertion-behavior) for deferred lists and inserting into more than one list.

## Selecting a View with Actions

Mutations may change data that is not directly specified in the mutation result. For example, adding a comment increases the post's comment count. For such cases, you can provide a `view` to an action that specifies which fields to fetch as part of the mutation:

```tsx
addComment({
  input: { content: 'New Comment text', postId: post.id },
  view: view<Comment>()({
    ...CommentView,
    post: { commentCount: true },
  }),
});
```

The server returns the selected fields, and views that display the post's comment count update automatically.

## Mutations

Use `fate.mutations` to call a mutation outside a React Action, or when calls should run without waiting for earlier actions to finish:

```tsx
const result = await fate.mutations.comment.add({
  input: { content, postId: post.id },
});
```

The options are the same as for Actions, including `optimistic`, `insert`, and `view`. The call returns a promise; handle pending state and errors in the calling code.

## Mutation Server Implementation

Define mutations in your backend and return the fields requested by the client. See [Server Integration](/integrations/server#custom-mutations) for native HTTP and tRPC, [GraphQL Integration](/integrations/graphql#mutations) for an existing GraphQL API, or [Void Integration](/integrations/void) for a Void app.

## Action & Mutation Error Handling

Expected errors, such as a validation failure or a `404`, are returned in `result.error`. You can show a message next to the button or form:

```tsx
const [result, deletePost] = useActionState(fate.actions.post.delete, null);

if (result?.error) {
  return <p>Could not delete this post. Please try again.</p>;
}
```

Network failures, server errors, and authentication or authorization errors are thrown. React Actions send them to the nearest error boundary:

```tsx
<ErrorBoundary FallbackComponent={ErrorComponent}>
  <Suspense fallback={<div>Loading…</div>}>
    <PostPage postId={postId} />
  </Suspense>
</ErrorBoundary>
```

When calling `fate.mutations` directly, use `try`/`catch` to handle thrown errors. Both kinds of failure roll back optimistic updates. GraphQL error codes are described in [Errors and Partial Results](/integrations/graphql#errors-and-partial-results).

## Deleting Records

Pass `delete: true` to remove an object immediately. fate also removes it from lists that contain it and restores it if the mutation fails:

```tsx
const [result, deleteAction] = useActionState(fate.actions.post.delete, null);

deleteAction({
  input: { id: post.id },
  delete: true,
});
```

## Resetting Action State

To clear an action's result without sending another mutation, dispatch `'reset'` inside a transition:

```tsx
import { startTransition, useActionState } from 'react';

const [result, like] = useActionState(fate.actions.post.like, null);

const dismiss = () => startTransition(() => like('reset'));
```

## Controlling List Insertion Behavior

Choose which list should receive a new object with `insert`. For example, comments can be deferred and still used directly as an insertion target:

```tsx
const PostCommentsView = view<Post>()({
  comments: defer({
    args: { first: 20 },
    items: { node: CommentView },
  }),
  id: true,
});

// Inside a component that receives postRef:
const post = useView(PostCommentsView, postRef);

const addComment = () =>
  fate.mutations.comment.add({
    input: { content: 'New Comment text', postId: post.id },
    insert: { into: post.comments, position: 'after' },
    optimistic: {
      content: 'New Comment text',
      id: 'optimistic:new-comment',
    },
    view: CommentView,
  });
```

Passing `post.comments` does not fetch the comments. If they haven't loaded yet, fate keeps the insertion until they do. You can also pass a resolved array or connection from a request or view. Use the original value from the same client, rather than a copied or filtered array.

Use an array of insertion objects to update multiple lists, with an independent position for each:

```tsx
await fate.mutations.comment.add({
  input: { content, postId: post.id },
  insert: [
    { into: post.comments, position: 'after' },
    { into: recentComments, position: 'before' },
  ],
  view: CommentView,
});
```

Only the named lists receive the new comment. Filters and sorting are still your app's choice: use `before` or `after` to match how each list is ordered. An object already in a list is updated without being duplicated or moved.

Insertions work with pagination, optimistic updates, and [offline mutations](/guide/persistence). Appended comments stay after later pages as they load; prepended comments stay before earlier pages.

### Migrating from automatic insertion

Earlier versions appended mutation results automatically. Add an `insert` option to calls that relied on that behavior. The strings `'before'` and `'after'` still enable automatic list matching, but prefer an explicit target. `'none'` is now the default.
