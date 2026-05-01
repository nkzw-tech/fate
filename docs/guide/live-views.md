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

The native HTTP transport opens one Server-Sent Events (SSE) connection per Fate client. When components mount or unmount live views, the client sends subscribe and unsubscribe control messages to the server. The server keeps those selections on the connection and sends updates only for records that connection subscribed to.

When the server sends an update, fate normalizes the selected record into the same cache used by requests, actions, and mutations. Components that read affected fields re-render automatically.

For example, if `PostView` selects `likes`, a live update that changes `likes` re-renders the `PostCard`. If another component only selected `title`, it does not re-render for a `likes` change.

Live deletion events remove the record from the normalized cache in the same way as mutations, and any lists or object fields that reference it are pruned.

## Client Setup

Generate the client with the native transport and point it at your Fate endpoint:

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

Live views use an event bus. The bus only signals that an object changed; fate refetches the selected object through the same data view pipeline used by `byId` queries before sending it to the client.

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

    live.update('Post', input.postId);

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
live.update('Post', postId);
```

You can pass an `eventId` when emitting. fate sends it on the native SSE event so clients can resume from the last received event when supported by your deployment:

```tsx
live.update('Post', input.id, { eventId: `post:${input.id}:${Date.now()}` });
```

## Error Handling

Live subscription errors are reported out of band. They do not replace the last cached data or throw through the component that called `useLiveView`.

Pass `onLiveError` when creating the client to send those failures to your logger or monitoring system:

```tsx
const fate = createFateClient({
  links,
  onLiveError(error) {
    captureException(error);
  },
});
```

The handler runs in a microtask after the subscription reports the error. Components continue to read whatever data is currently available in the fate cache.
