# Live Views

`useLiveView` resolves a `ViewRef` just like `useView`, but also keeps the selected object up to date through the native live SSE transport.

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

The API mirrors `useView`: pass a view and a ref, and get back the same masked data shape. A `null` ref returns `null` and does not subscribe.

## How Live Updates Work

The native HTTP transport opens one Server-Sent Events (SSE) connection per fate client. When components mount or unmount live views, the client sends subscribe and unsubscribe control messages to the server. The server keeps those selections on the connection and sends updates only for records that connection subscribed to.

When the server sends an update, fate normalizes the selected record into the same cache used by requests, actions, and mutations. Components that read affected fields re-render automatically.

For example, if `PostView` selects `likes`, a live update that changes `likes` re-renders the `PostCard`. If another component only selected `title`, it does not re-render for a `likes` change.

Live deletion events remove the record from the normalized cache in the same way as mutations, and any lists or object fields that reference it are pruned.

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

> [!NOTE]
>
> Live views use `GET /fate/live` for the single SSE stream and `POST /fate/live` for subscribe/unsubscribe control messages.

## Server Setup

Live views use an event bus. By default, the bus signals that an object changed and fate refetches the selected object through the same data view pipeline used by `byId` queries before sending it to the client. Update events can also include changed field paths so fate only resolves the intersection of those paths and each active subscription.

Pass a live event bus to `createFateServer` and expose the native handler:

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

fate keeps a bounded in-memory queue for each native SSE connection while live events are waiting to be resolved and sent. The default limit is `1000` queued events per connection. If a client falls behind and exceeds the limit, fate closes that live connection so server memory cannot grow without bound. You can tune the limit by passing the object form:

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

By default, live appends and prepends respect pagination boundaries. If the relevant edge still has more pages, fate keeps the incoming node attached to that edge instead of expanding the loaded window. For chat or activity streams where new items should keep appearing immediately, opt into visible live insertion on the connection view:

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

Connection identity follows Relay's model: pagination args like `first`, `last`, `after`, and `before` are ignored for live connection matching, while filter args such as `categoryId` are part of the identity.

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

The default `createLiveEventBus` is an in-memory fanout bus and does not replay events that were emitted while a client was disconnected. Use a durable custom live bus if your deployment needs reconnects to catch up from `lastEventId`; otherwise the client receives future live events after it reconnects.

## Error Handling

Live subscription errors are reported out of band. They do not replace the last cached data or throw through the component that called `useLiveView`.

Pass `onLiveError` when creating the client to send those failures to your logger or monitoring system:

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

The handler runs in a microtask after the subscription reports the error. Components continue to read whatever data is currently available in the fate cache.
