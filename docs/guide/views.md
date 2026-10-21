# Views

## Defining Views

Let's start by defining a simple view for a blog's `Post` component. fate requires you to explicitly "select" each field that you plan to use in your components. Here is how you can define a view for a `Post` entity that has `title` and `content` fields:

```tsx
import type { Post } from '@your-org/server/views';
import { view } from 'react-fate';

export const PostView = view<Post>()({
  content: true,
  id: true,
  title: true,
});
```

Fields are selected by setting them to `true` in the view definition. This tells **_fate_** that these fields should be fetched from the server and made available to components that use this view.

## Resolving a View with `useView`

Now we can use the view that we defined in a `PostCard` React component to resolve the data against a reference of an individual `Post`:

```tsx
import { useView, ViewRef } from 'react-fate';

export const PostCard = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  const post = useView(PostView, postRef);

  return (
    <Card>
      <h2>{post.title}</h2>
      <p>{post.content}</p>
    </Card>
  );
};
```

A `ViewRef` refers to a specific object, for example a `Post` with ID `7`. fate creates these references for you so you can pass them to child components.

Components using `useView` listen to changes for all selected fields. When data changes, fate re-renders all of the fields that depend on that data. For example, if the `title` of the `Post` changes, the `PostCard` component re-renders with new data. However, if a different field such as `likes` that isn't selected in `PostView` changes, the `PostCard` component will not re-render.

## Fetching Data with `useRequest`

Now that we defined our view and component, we fetch the data from the server using the `useRequest` hook from fate. This hook allows us to declare what data we need for a specific screen or component tree. At the root of our app, we can request a list of posts like this:

```tsx
import { useRequest } from 'react-fate';
import { PostCard, PostView } from './PostCard.tsx';

export function App() {
  const { posts } = useRequest({ posts: { list: PostView } });

  return posts.map((post) => <PostCard key={post.id} post={post} />);
}
```

_Learn more about `useRequest` in the [Requests Guide](/guide/requests)._

## Composing Views

In the above example we are defining a single view for a `Post`. One of fate's core strengths is view composition. Let's say we want to show the author's name along with the post. A simple way to do this is by adding an `author` field to the `PostView` with a concrete selection:

```tsx
import { Suspense } from 'react';
import { useView, ViewRef } from 'react-fate';

export const PostView = view<Post>()({
  author: {
    id: true,
    name: true,
  },
  content: true,
  id: true,
  title: true,
});

const PostCard = ({ postRef }: { postRef: ViewRef<'Post'> }) => {
  const post = useView(PostView, postRef);
  return (
    <Card>
      <h2>{post.title}</h2>
      <p>by {post.author.name}</p>
      <p>{post.content}</p>
    </Card>
  );
};
```

This code fetches the author associated with the Post and makes it available to the `PostCard` component. However, this approach has some downsides:

1. The `author` selection is tightly coupled to the `PostView`. If we want to use the author's data in another component, we would need to duplicate the field selection.
1. If the `author` has more fields that we want to use in other components, we would need to add them to the `PostView`, leading to overfetching.
1. We cannot reuse the `author` field selection in other views or components.

In fate, views are composable and reusable. Instead of inlining the selection, we can define a `UserView` and compose it into the `PostView` like this:

```tsx
import type { Post, User } from '@your-org/server/views';
import { view } from 'react-fate';

export const UserView = view<User>()({
  id: true,
  name: true,
  profilePicture: true,
});

export const PostView = view<Post>()({
  author: UserView,
  content: true,
  id: true,
  title: true,
});
```

Now we can create a separate `UserCard` component that uses our `UserView`:

```tsx
import { useView, ViewRef } from 'react-fate';

export const UserCard = ({ user: userRef }: { user: ViewRef<'User'> }) => {
  const user = useView(UserView, userRef);

  return (
    <div>
      <img src={user.profilePicture} alt={user.name} />
      <p>{user.name}</p>
    </div>
  );
};
```

And update `PostCard` to use our `UserCard` component:

```tsx
import { UserCard } from './UserCard.tsx';

export const PostCard = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  const post = useView(PostView, postRef);

  return (
    <Card>
      <h2>{post.title}</h2>
      <UserCard user={post.author} />
      <p>{post.content}</p>
    </Card>
  );
};
```

## View Spreads

When building complex UIs, you will often build multiple components that share the same data requirements. In fate, you can use view spreads to compose such views together. This is similar to GraphQL fragment spreads, but works with plain JavaScript objects.

Let's assume we want to fetch and display additional information about the author in the `PostCard`, such as their bio. Instead of directly assigning our `UserView` to the `author` field, we can instead spread it and add the `bio` field:

```tsx
export const PostView = view<Post>()({
  author: {
    ...UserView,
    bio: true,
  },
  content: true,
  id: true,
  title: true,
});
```

Now the `PostCard` component can access the `bio` field of the author:

```tsx
export const PostCard = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  const post = useView(PostView, postRef);

  return (
    <Card>
      <h2>{post.title}</h2>
      <UserCard author={post.author} />
      {/* Accessing the bio field */}
      <p>{post.author.bio}</p>
      <p>{post.content}</p>
    </Card>
  );
};
```

We can also spread multiple views together. For example, if we have another view called `UserStatsView` that selects some statistics about the user, we can include it in the `PostView` like this:

```tsx
export const UserStatsView = view<User>()({
  followerCount: true,
  postCount: true,
});

export const PostView = view<Post>()({
  author: {
    ...UserView,
    ...UserStatsView,
    bio: true,
  },
  content: true,
  id: true,
  title: true,
});
```

Views are opaque objects. Even if you select the same field multiple times through different views, the composed object won't have conflicting fields or result in TypeScript errors. fate automatically deduplicates fields during runtime and ensures that each field is only fetched once.

## Resolving Multiple Refs with `useViews`

Use `useViews` when a component needs selected data from an array of refs, for example to filter or sort a list before rendering it:

```tsx
import { useViews, type ViewRef } from 'react-fate';

function PostTitles({ posts: postRefs }: { posts: ReadonlyArray<ViewRef<'Post'>> }) {
  const posts = useViews(PostView, postRefs);
  const sorted = [...posts].sort((a, b) => a.title.localeCompare(b.title));

  return sorted.map((post) => <h2 key={post.id}>{post.title}</h2>);
}
```

Call `useViews` once with the whole array instead of calling `useView` inside a loop. Results follow the input order and update when selected fields change. Like `useView`, the hook suspends while data is loading and sends read errors to the nearest error boundary.

The array can change between renders. Deferred refs are supported, and `null` or `undefined` entries keep their values in the result.

Vue provides the same API as a reactive resource. See [Resolving Arrays of Refs in Vue](/guide/vue#resolving-arrays-of-refs).

## `useView` and Suspense

We learned that `useRequest` is responsible for fetching data from the server and `useView` is used for reading data from the cache. In some situations data may not be available in the cache and `useView` might need to suspend the component to fetch only the missing data. Once that data is fetched and written to the cache, the component resumes rendering.

_Tip: You can test this behavior in development mode with Fast Refresh (HMR) enabled in your bundler. When you edit the selection of a view, components using that view will suspend, fetch the missing data, and then resume rendering._

## Type Safety and Data Masking

fate provides guarantees through TypeScript and during runtime that prevent you from accessing data that wasn't selected in a component. This ensures that you declare all the data dependencies at the right level in your component tree, and prevents accidental coupling between components.

In the below example, we forgot to select the `content` of a `Post`. As a result, type-checks fail and the `content` field is undefined during runtime:

```tsx
const PostView = view<Post>()({
  id: true,
  title: true,
  // `content: true` is omitted.
});

const PostCard = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  const post = useView(PostView, postRef);

  return (
    <Card>
      <h2>{post.title}</h2>
      {/* TypeScript errors here, and `post.content` is undefined during runtime */}
      <p>{post.content}</p>
    </Card>
  );
};
```

Views can only be resolved against refs that include that view directly or via view spreads. If a component tries to resolve a view against a ref that isn't linked, it will throw an error during runtime:

```tsx
const PostDetailView = view<Post>()({
  content: true,
});

const AnotherPostView = view<Post>()({
  content: true,
});

const PostView = view<Post>()({
  id: true,
  title: true,
  ...AnotherPostView,
});

const PostCard = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  const post = useView(PostView, postRef);
  return <PostDetail post={post} />;
};

const PostDetail = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  // This throws because the post reference passed into this component
  // is of type `AnotherPostView`, not `PostDetailView`.
  const post = useView(PostDetailView, postRef);
};
```

## Parameters and Conditional Selections

A view can take parameters. Define the selection with a function, then bind its parameters where you request or compose the view:

```tsx
import type { User } from '@your-org/server/views';
import { alias, useRequest, useView, view, when, type ViewRef } from 'react-fate';

const AccountView = view<User>()({ email: true });

const ProfileView = view<User>()(({ isViewer }: { isViewer: boolean }) => ({
  name: true,
  account: when(isViewer, alias(AccountView)),
}));

function Profile({ userId, isViewer }: { userId: string; isViewer: boolean }) {
  const { user } = useRequest({
    user: { id: userId, view: ProfileView({ isViewer }) },
  });
  const profile = useView(ProfileView, user);
  const account = useView(AccountView, profile.account);

  return (
    <div>
      <h2>{profile.name}</h2>
      {account && <p>{account.email}</p>}
    </div>
  );
}
```

`alias(AccountView)` gives us an `account` ref to the same user. It doesn't require an `account` field on the server. Read it with `useView`, just like any other ref.

`when(condition, selection)` works with named fragments and ordinary fields:

```tsx
const ProfileView = view<User>()(({ isViewer }: { isViewer: boolean }) => ({
  name: true,
  email: when(isViewer, true),
}));
```

When the condition is false, the field is `undefined` and isn't fetched. `useView` and `useLiveView` accept that undefined ref, so you can call them unconditionally, as above.

### Carrying Parameters with Refs

Bindings travel with refs. Child components read the view definition without reconstructing its parameters:

```tsx
const LocalizedNameView = view<User>()(({ locale }: { locale: string }) => ({
  name: { args: { locale } },
}));

const NamesView = view<User>()({
  english: alias(LocalizedNameView({ locale: 'en' })),
  japanese: alias(LocalizedNameView({ locale: 'ja' })),
});

function Names({ user }: { user: ViewRef<'User'> }) {
  const names = useView(NamesView, user);
  const english = useView(LocalizedNameView, names.english);
  const japanese = useView(LocalizedNameView, names.japanese);

  return (
    <p>
      {english.name} / {japanese.name}
    </p>
  );
}
```

Here `name` accepts a `locale` argument on the server. Both refs point to the same user, but each keeps its own parameters.

Define views outside components, then pass parameters when composing or requesting them. No `useMemo` is needed. Use named aliases when you need several versions of the same view, or `when(condition, alias(View))` to include one conditionally.

### Vue

The same `view`, `alias`, and `when` API is available from `vue-fate`. Pass reactive refs or getters to the view composables:

```ts
const profile = useView(ProfileView, () => request.value?.user);
const account = useView(AccountView, () => profile.value?.account);
```

An undefined ref produces an undefined value without fetching.
