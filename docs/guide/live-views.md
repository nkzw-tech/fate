# Live Views

`useLiveView` resolves a `ViewRef` just like `useView`, but also keeps the selected object up to date through a live tRPC subscription.

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

When the server sends an update through Server-Sent-Events (SSE), fate normalizes the selected record into the same cache used by requests, actions, and mutations. Components that read affected fields re-render automatically.

For example, if `PostView` selects `likes`, a live update that changes `likes` re-renders the `PostCard`. If another component only selected `title`, it does not re-render for a `likes` change.

Live deletion events remove the record from the normalized cache in the same way as mutations, and any lists or object fields that reference it are pruned.

## Client Setup

tRPC subscriptions need a subscription link. For HTTP/SSE, use `httpSubscriptionLink` for subscription operations and keep `httpBatchLink` for queries and mutations:

```tsx
import { httpBatchLink, httpSubscriptionLink, splitLink } from '@trpc/client';
import { FateClient } from 'react-fate';
import { createFateClient } from '@nkzw/fate/client';

export function App() {
  const fate = useMemo(
    () =>
      createFateClient({
        links: [
          splitLink({
            condition: (operation) => operation.type === 'subscription',
            false: httpBatchLink({
              fetch: (input, init) =>
                fetch(input, {
                  ...init,
                  credentials: 'include',
                }),
              url: `${env('SERVER_URL')}/trpc`,
            }),
            true: httpSubscriptionLink({
              eventSourceOptions: {
                withCredentials: true,
              },
              url: `${env('SERVER_URL')}/trpc`,
            }),
          }),
        ],
      }),
    [],
  );

  return <FateClient client={fate}>{/* Components go here */}</FateClient>;
}
```

> [!NOTE]
>
> `httpSubscriptionLink` uses Server-Sent Events. If your app does not need cookies for subscriptions, you can omit `eventSourceOptions`.

## Server Setup

Live views use an event bus. The bus only signals that an object changed; fate refetches the selected object through the same data view pipeline used by `byId` queries before sending it to the client.

Create one bus next to your tRPC helpers:

```tsx
import { createLiveEventBus } from '@nkzw/fate/server';
import { createPrismaFate } from '@nkzw/fate/server/prisma';
import { initTRPC } from '@trpc/server';
import type { AppContext } from './context.ts';
import { Root } from './views.ts';

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const procedure = t.procedure;
export const live = createLiveEventBus();

export const fate = createPrismaFate<AppContext, typeof procedure>({
  procedure,
  views: Root,
});
```

Then enable live subscriptions for the data view you want to expose:

```tsx
import { fate, live, procedure, router } from '../init.ts';
import { postDataView } from '../views.ts';

export const postRouter = router({
  ...fate.procedures({
    live,
    view: postDataView,
  }),
});
```

The shorthand above is equivalent to `live: { bus: live }`. If your event bus has a different variable name, pass it as `live: events`. The generated procedure is called `live`, so the generated client can map `Post` refs to `client.post.live.subscribe`.

Once this is in place, components can switch from `useView` to `useLiveView` without changing their view definitions or return types.

## Emitting Events

After a mutation changes an object, emit an update event for that object:

```tsx
export const postRouter = router({
  ...fate.procedures({
    live,
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

You can pass an `eventId` when emitting. fate wraps events with tRPC's tracked envelope so clients can resume from the last received SSE event when supported by your deployment:

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
