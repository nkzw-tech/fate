# List Views

## Pagination with `useListView`

You can wrap a list of references using `useListView` to enable connection-style lists with pagination support.

For example, you can define a `CommentView` and reuse it inside of a `CommentConnectionView`:

```tsx
import { useListView, ViewRef } from 'react-fate';

const CommentView = view<Comment>()({
  content: true,
  id: true,
});

const CommentConnectionView = {
  args: { first: 10 },
  items: {
    node: CommentView,
  },
};

const PostView = view<Post>()({
  comments: CommentConnectionView,
});
```

Now you can apply the `useListView` hook inside of your `PostCard` component to read the list of comments and load more comments when needed:

```tsx
export function PostCard({ detail, post: postRef }: { detail?: boolean; post: ViewRef<'Post'> }) {
  const post = useView(PostView, postRef);
  const [comments, loadNext] = useListView(CommentConnectionView, post.comments);

  return (
    <div>
      {comments.map(({ node }) => (
        <CommentCard comment={node} key={node.id} post={post} />
      ))}
      {loadNext ? (
        <Button onClick={loadNext} variant="ghost">
          Load more comments
        </Button>
      ) : null}
    </div>
  );
}
```

If `loadNext` is undefined, it means there are no more comments to load. If you want to instead load previous comments, you can use the third argument returned by `useListView`, which is `loadPrevious`. Similarly, if there are no previous comments to load, `loadPrevious` will be undefined.

## Pagination Arguments

Connection views can define default arguments, and `useListView` carries those arguments forward when loading more pages:

```tsx
const CommentConnectionView = {
  args: { first: 10 },
  items: {
    cursor: true,
    node: CommentView,
  },
  pagination: {
    hasNext: true,
    hasPrevious: true,
    nextCursor: true,
    previousCursor: true,
  },
};
```

When `loadNext` runs, fate sends the next cursor as `after` and keeps the page size in `first`. When `loadPrevious` runs, fate sends the previous cursor as `before` and uses `last` for the page size. This lets the server distinguish forward and backward pagination while keeping the component API small.

Additional arguments on a root request are scoped to that root list:

```tsx
const { posts } = useRequest({
  posts: {
    args: { categoryId: category.id, first: 20 },
    list: PostConnectionView,
  },
});
```

The `categoryId` list above has its own cache entry and pagination state. Loading another page for that list does not update a different `posts` request with another category or search query.
