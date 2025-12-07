# Actions

fate does not provide hooks for mutations like traditional data fetching libraries do. Instead, mutations are exposed in two ways:

- `fate.actions` for use with [`useActionState`](https://react.dev/reference/react/useActionState) and React Actions.
- `fate.mutations` for traditional imperative mutation calls.

Mutations in your tRPC backend are made available as actions and mutations by fate's generated client.

Let's assume that our `Post` entity has a tRPC mutation for liking a post called `post.like`. A `LikeButton` component using fate Actions and an async component library could then look like this:

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
  const [result, like, isPending] = useActionState(
    fate.actions.post.like,
    null,
  );

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

By using `useActionState`, fate Actions integrate with Suspense and concurrent rendering.

## Optimistic Updates

fate Actions support optimistic updates out of the box. For example, to update the post's like count optimistically, you can pass an `optimistic` object to the action call. This will immediately update the cache with the new like count and re-render all views that select the `likes` field:

```tsx
like({
  input: { id: post.id },
  optimistic: { likes: post.likes + 1 },
});
```

When data changes through optimistic updates or otherwise, fate only re-renders the views that select the changed fields. In the above example, only views that select the `likes` field will re-render. If a view only selects the `title` field, it won't re-render when the `likes` field changes.

If a mutation fails, the cache will be rolled back to its previous state and any views depending on the mutated data will be updated.

## Inserting New Objects

When a mutation inserts a new object, you can provide an optimistic object with a temporary ID to represent the new object in the cache until the server responds with the actual ID. For example, to add a new comment to a post optimistically, you can do the following:

```tsx
const content = 'New Comment text';
addComment({
  input: { content, postId: post.id },
  optimistic: {
    author: { id: user.id, name: user.name },
    content,
    id: `optimistic:${Date.now().toString(36)}`,
    post: { commentCount: post.commentCount + 1, id: post.id },
  },
});
```

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

The server will return the selected fields and fate updates the cache and re-renders all views that depend on the changed data. The action result contains the newly added comment with the selected fields:

```tsx
const [result, addComment] = useActionState(fate.actions.comment.add, null);

const newComment = result?.result;
if (newComment) {
  // All the fields selected in the view are available on `newComment`:
  console.log(newComment.post.commentCount);
}
```

## Mutations

fate Actions are the recommended way to execute server mutations in React components. However, there are cases where you might want to call mutations imperatively, outside of React components, or without waiting for previous actions to finish like `useActionState` does. For such cases, you can use `fate.mutations` to call mutations imperatively:

```tsx
const result = await fate.mutations.comment.add({
  input: { content, postId: post.id },
});
```

You can call mutations from anywhere, and without waiting for previous mutations to finish. The mutation API matches the API of fate Actions, including optimistic updates and view selection. With mutations, you'll need to handle loading states and errors manually, and the result is returned as a promise.

## Mutation Server Implementation

fate Actions & Mutations are backed by regular tRPC mutations on the server. Here is an example implementation of the `like` mutation in the `postRouter`.

```tsx
import { z } from 'zod';
import { connectionArgs, createResolver } from '@nkzw/fate/server';
import { procedure, router } from '../init.ts';
import { postDataView, PostItem } from '../views.ts';

export const postRouter = router({
  like: procedure
    .input(
      z.object({
        args: connectionArgs,
        id: z.string().min(1, 'Post id is required.'),
        select: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { resolve, select } = createResolver({
        ...input,
        ctx,
        view: postDataView,
      });

      const updated = await ctx.prisma.post.update({
        data: {
          likes: {
            increment: 1,
          },
        },
        select,
        where: { id: input.id },
      });
      return resolve(updated as unknown as PostItem);
    }),
});
```

See the [Server Integration](#server-integration) section for more details on how to integrate tRPC routers with fate.

## Action & Mutation Error Handling

fate Actions & Mutations separate error handling into two scopes: "call site" and "boundary". Call site errors are expected to be handled at the location where the action or mutation is called. Boundary errors are unexpected errors that should be handled by a higher-level error boundary.

If your server returns a `NOT_FOUND` error with code `404`, the result of an Action or Mutation will contain an error object that you can handle at the call site:

```tsx
const [result] = useActionState(fate.actions.post.delete, null);

if (result?.error) {
  if (result.error.code === 'NOT_FOUND') {
    // Handle not found error at call site.
  } else {
    // Handle other *expected* errors.
  }
}
```

However, if an `INTERNAL_SERVER_ERROR` error with code `500` occurs, it will be thrown and can be caught by the nearest React error boundary:

```tsx
<ErrorBoundary FallbackComponent={ErrorComponent}>
  <Suspense fallback={<div>Loading…</div>}>
    <PostPage postId={postId} />
  </Suspense>
</ErrorBoundary>
```

You can find the error classification behavior in [`mutation.ts`](https://github.com/nkzw-tech/fate/blob/main/packages/fate/src/mutation.ts#L227-L254).

## Deleting Records

When you want to delete a record using fate Actions, you can pass a `delete: true` flag to the action call. This flag removes the object from the cache and re-renders all views that depend on the deleted data:

```tsx
const [result, deleteAction] = useActionState(fate.actions.post.delete, null);

deleteAction({
  input: { id: post.id },
  delete: true,
});
```

## Resetting Action State

When using `useActionState`, the result of the action is cached until the component using the action is unmounted. When a mutation fails with an error, you might want to clear the error state without invoking the action again. fate Actions take a `'reset'` token to reset the action state:

```tsx
const [result, like] = useActionState(fate.actions.post.like, null);

useEffect(() => {
  if (result?.error) {
    // Reset the action state after 3 seconds.
    const timeout = setTimeout(
      () => startTransition(() => like('reset')),
      3000,
    );
    return () => clearTimeout(timeout);
  }
}, [like, result]);
```
