import type { Post } from '@nkzw/fate-server/src/trpc/views.ts';
import { useParams } from '@void/react';
import { useActionState } from 'react';
import { useFateClient, useListView, useRequest, useView, view, type ViewRef } from 'react-fate';
import { Button } from '../../src/ui/Button.tsx';
import Card from '../../src/ui/Card.tsx';
import Link from '../../src/ui/Link.tsx';
import Section from '../../src/ui/Section.tsx';
import AuthClient from '../../src/user/AuthClient.tsx';

const PaginationPostView = view<Post>()({ content: true, id: true, title: true });
const PreviewPostView = view<Post>()({ ...PaginationPostView });
const OtherPostView = view<Post>()({ ...PaginationPostView });
const pagination = { hasNext: true, nextCursor: true } as const;
const feeds = {
  full: {
    args: { first: 2 },
    items: { node: PaginationPostView },
    pagination,
  },
  other: {
    args: { first: 5 },
    items: { node: OtherPostView },
    pagination,
  },
  preview: {
    args: { first: 5 },
    items: { node: PreviewPostView },
    pagination,
  },
};

function PostRow({ post: ref }: { post: ViewRef<'Post'> }) {
  const post = useView(PaginationPostView, ref);
  return (
    <Card>
      <Link to={`/post/${post.id}`}>
        <h2 className="text-xl font-semibold">{post.title}</h2>
      </Link>
      <p>{post.content}</p>
    </Card>
  );
}

function Feed({ name }: { name: keyof typeof feeds }) {
  const fate = useFateClient();
  const { data: session } = AuthClient.useSession();
  const selection = feeds[name];
  const request = { posts: { list: selection } };
  const { posts } = useRequest(request);
  const [items, loadNext] = useListView(selection, posts);
  const [error, act, isPending] = useActionState(
    async (_error: string | null, action: 'load' | 'refresh' | 'insert' | 'fail') => {
      try {
        if (action === 'load') {
          await loadNext?.();
        } else if (action === 'refresh') {
          await fate.request(request, { mode: 'network-only' });
        } else {
          const result = await fate.mutations.post.add({
            input: {
              content: 'Created from the pagination demo.',
              title: action === 'fail' ? '' : 'A new pagination demo post',
            },
            insert: { into: posts, position: 'before' },
            optimistic: {
              content: 'Created from the pagination demo.',
              id: `optimistic:${crypto.randomUUID()}`,
              title: 'Saving a new post…',
            },
            view: PaginationPostView,
          });
          return result.error?.message ?? null;
        }
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    null,
  );

  return (
    <div className="space-y-6">
      <p className="text-lg" role="status">
        Showing {items.length} posts
      </p>
      <div className="flex flex-wrap gap-2">
        <Button action={() => act('refresh')} disabled={isPending} variant="outline">
          Refresh this feed
        </Button>
        <Button action={() => act('insert')} disabled={isPending || !session} variant="outline">
          Insert a post
        </Button>
        <Button action={() => act('fail')} disabled={isPending || !session} variant="outline">
          Fail an optimistic insertion
        </Button>
      </div>
      {!session && <p className="text-sm text-muted-foreground">Sign in to test insertions.</p>}
      {error && (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="space-y-5">
        {items.map(({ node }) => (
          <PostRow key={node.id} post={node} />
        ))}
      </div>
      {loadNext ? (
        <Button action={() => act('load')} disabled={isPending}>
          Load more posts
        </Button>
      ) : (
        <p>All posts loaded.</p>
      )}
    </div>
  );
}

export default function PaginationPage() {
  const { feed } = useParams<{ feed: string }>();
  const name = feed === 'full' || feed === 'other' ? feed : 'preview';

  return (
    <Section gap={24}>
      <h1 className="text-3xl font-semibold">Independent pagination</h1>
      <p>
        These feeds share the existing posts and client cache. Each view remembers its own loaded
        range when you leave and return, without expanding the others.
      </p>
      <nav className="flex flex-wrap gap-2">
        {(['preview', 'full', 'other'] as const).map((feed) => (
          <Button asChild key={feed} variant={name === feed ? 'secondary' : 'outline'}>
            <Link aria-current={name === feed ? 'page' : undefined} to={`/pagination/${feed}`}>
              {feed === 'preview'
                ? 'Preview · 5 posts'
                : feed === 'full'
                  ? 'Full feed · 2 posts'
                  : 'Another view · 5 posts'}
            </Link>
          </Button>
        ))}
        <Button onClick={() => history.back()} variant="ghost">
          Back
        </Button>
      </nav>
      <Card>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            Open Full feed and load several pages. Return to Preview: it should still show five
            posts.
          </li>
          <li>
            Paginate Preview, open a post, then go Back. Preview should retain its loaded range.
          </li>
          <li>
            Paginate Another view. Preview should keep its own range despite using the same page
            size.
          </li>
          <li>Refresh a paginated feed: its cached continuation pages should remain visible.</li>
          <li>
            Sign in to insert a real post or reject an optimistic insertion using an invalid title.
          </li>
        </ol>
        <p className="text-sm text-muted-foreground">
          Use browser network throttling to inspect pending requests and optimistic rollback. Reload
          to clear the client cache. Successful insertions create real posts in the example
          database.
        </p>
      </Card>
      <Feed key={name} name={name} />
    </Section>
  );
}
