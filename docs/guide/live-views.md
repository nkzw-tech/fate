# Live Views

Use `useLiveView` to keep a view up to date when its data changes on the server:

```tsx
import { useLiveView, ViewRef } from 'react-fate';

export const PostCard = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  const post = useLiveView(PostView, postRef);

  return (
    <Card>
      <h2>{post.title}</h2>
      {/* Updates automatically! */}
      <p>{post.likes} likes</p>
    </Card>
  );
};
```

It takes the same view and ref as `useView`. Only the selected fields are available, and components update when those fields change.

## How Live Updates Work

fate uses one live connection per client, shared by its mounted live views. When the server sends an update, fate writes it to the cache and updates components that select the changed fields.

For example, a change to `likes` updates `PostCard` without re-rendering a component that only selects `title`. Deleting an object also removes references to it from lists and other objects.

## Client Setup

Configure the native transport and point the client at your fate endpoint:

```tsx
import { FateClient } from 'react-fate';
import { createFateClient } from 'react-fate/client';

export function App() {
  const fate = useMemo(
    () =>
      createFateClient({
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            credentials: 'include',
          }),
        url: `${env('SERVER_URL')}/fate`,
      }),
    [],
  );

  return <FateClient client={fate}>{/* Components go here */}</FateClient>;
}
```

This example uses native HTTP. For a GraphQL server, see [GraphQL Live Views](/integrations/graphql#live-views).

## Server Setup

Pass an event bus to `createFateServer` so your mutations can tell fate which objects changed:

```tsx
import { createFateServer, createHonoFateHandler, createLiveEventBus } from '@nkzw/fate/server';
import type { AppContext } from './context.ts';
import { sources } from './sources.ts';
import { Root } from './views.ts';

export const live = createLiveEventBus();

export const fate = createFateServer<AppContext>({
  live,
  roots: Root,
  sources,
});

app.all('/fate/*', createHonoFateHandler(fate));
```

If a client falls behind, fate closes its connection after 1,000 queued events. You can change the limit with `maxQueueSize`:

```tsx
export const fate = createFateServer<AppContext>({
  live: {
    bus: live,
    maxQueueSize: 500,
  },
  roots: Root,
  sources,
});
```

Once this is in place, components can switch from `useView` to `useLiveView` without changing their view definitions or return types.

## Live List Views

`useLiveListView` mirrors `useListView`, but subscribes to live connection events for the connection it receives:

```tsx
import { useLiveListView, useLiveView, ViewRef } from 'react-fate';

export function PostCard({ post: postRef }: { post: ViewRef<'Post'> }) {
  const post = useLiveView(PostView, postRef);
  const [comments, loadNext] = useLiveListView(CommentConnectionView, post.comments);

  return (
    <>
      {comments.map(({ node }) => (
        <CommentCard comment={node} key={node.id} />
      ))}
      {loadNext ? <button onClick={loadNext}>Load more</button> : null}
    </>
  );
}
```

The hook returns the same tuple as `useListView`: items, `loadNext`, and `loadPrevious`. Live events append, prepend, insert, or delete edges from one connection without deleting the underlying records.

By default, new items at an unloaded end of a list wait for pagination. For a chat or activity feed, use `append: 'visible'` to show new messages immediately:

```tsx
const MessageConnectionView = {
  args: { first: 30 },
  items: {
    node: MessageView,
  },
  live: {
    append: 'visible',
  },
};
```

Emit connection events on the server when list membership changes:

```tsx
live.connection('Post.comments', { id: postId }).prependNode('Comment', comment.id);
live.connection('Post.comments', { id: postId }).deleteEdge('Comment', comment.id);
```

For root lists, use the generated root procedure name:

```tsx
live.connection('posts', { categoryId }).prependNode('Post', post.id);
```

If the changed list cannot be described precisely, invalidate the active connection and fate will refetch it:

```tsx
live.connection('posts', { categoryId }).invalidate();
```

Pass the list's filters, such as `categoryId`, when emitting events. Pagination arguments like `first` and `after` don't affect which list receives an event.

## Emitting Events

After a mutation changes an object, emit an update event for that object:

```tsx
export const postRouter = router({
  ...fate.procedures({
    view: postDataView,
  }),
  like: procedure.input(likeInput).mutation(async ({ ctx, input }) => {
    const post = await ctx.prisma.post.update({
      data: {
        likes: {
          increment: 1,
        },
      },
      where: { id: input.id },
    });

    live.update('Post', input.id);

    return post;
  }),
});
```

This tells fate that the `Post` changed. Every active live view for that post refreshes using the selection it subscribed with.

If you know which fields changed, pass them with `changed` to reduce the amount of data sent to each subscriber:

```tsx
live.update('Post', input.id, { changed: ['likes'] });
```

With this version, a live view that selected `likes` refreshes only `likes`, while a live view that only selected unrelated fields is skipped entirely.

If a mutation changes a related object, emit for the object whose live view should refresh. For example, adding a comment usually changes the post's `commentCount` and `comments` list, so emit for the `Post`:

```tsx
export const commentRouter = router({
  add: procedure.input(addCommentInput).mutation(async ({ ctx, input }) => {
    const comment = await ctx.prisma.comment.create({
      data: {
        content: input.content,
        postId: input.postId,
      },
    });

    live.update('Post', input.postId, { changed: ['commentCount', 'comments'] });

    return comment;
  }),
});
```

For deletions, emit a delete event for the deleted object if clients may be subscribed to it:

```tsx
live.delete('Comment', input.id);
```

If deleting the object also changes another object, emit an update for that object too:

```tsx
live.update('Post', postId, { changed: ['commentCount', 'comments'] });
```

You can pass an `eventId` when emitting. fate sends it on the native SSE event and includes the last received event ID when it resubscribes after a reconnect:

```tsx
live.update('Post', input.id, {
  changed: ['likes'],
  eventId: `post:${input.id}:${Date.now()}`,
});
```

The default event bus doesn't replay missed events after a disconnect. For that, provide a custom live bus that resumes from `lastEventId`.

## Error Handling

Live errors leave the last cached data visible. Pass `onLiveError` to report them to your logger or monitoring system:

```tsx
const fate = createFateClient({
  fetch: (input, init) =>
    fetch(input, {
      ...init,
      credentials: 'include',
    }),
  onLiveError(error) {
    captureException(error);
  },
  url: `${env('SERVER_URL')}/fate`,
});
```

These errors don't go to the component's error boundary.
