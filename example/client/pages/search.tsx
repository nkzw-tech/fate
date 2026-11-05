import type { Comment, Post, User } from '@nkzw/fate-server/src/trpc/views.ts';
import Stack, { VStack } from '@nkzw/stack';
import { Suspense, useDeferredValue, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { viewFor, useRequest, useView, view, ViewRef } from 'react-fate';
import type { GeneratedClientRoots } from '../.fate/client.generated.ts';
import cx from '../src/lib/cx.tsx';
import { Button } from '../src/ui/Button.tsx';
import Card from '../src/ui/Card.tsx';
import CommentCard, { CommentView } from '../src/ui/CommentCard.tsx';
import Error from '../src/ui/Error.tsx';
import Input from '../src/ui/Input.tsx';
import Section from '../src/ui/Section.tsx';

const CommentPostView = view<Post>()({
  commentCount: true,
  id: true,
  title: true,
});

const CommentSearchView = view<Comment>()({
  ...CommentView,
  id: true,
  post: CommentPostView,
});

const isDevelopment = import.meta.env.DEV;
const transport = import.meta.env.VITE_FATE_TRANSPORT;
const supportsCommentSearch = !transport || transport === 'trpc';

const PostResultView = view<Post>()({ content: true, title: true });
const UserResultView = view<User>()({ name: true });
const MixedResultView = view<Post | User>()({
  ...viewFor('Post', PostResultView),
  ...viewFor('User', UserResultView),
});

const PostResult = ({ result }: { result: ViewRef<'Post'> }) => {
  const post = useView(PostResultView, result);
  return (
    <div>
      <h3 className="font-semibold">{post.title}</h3>
      <p>{post.content}</p>
    </div>
  );
};

const UserResult = ({ result }: { result: ViewRef<'User'> }) => {
  const user = useView(UserResultView, result);
  return <p>{user.name}</p>;
};

const MixedSearchResults = ({ isStale, query }: { isStale: boolean; query: string }) => {
  const request = { search: { args: { query }, list: MixedResultView } };
  const { search } = useRequest<typeof request, GeneratedClientRoots>(request);

  return (
    <VStack className={cx(isStale && 'opacity-50')} gap={12}>
      {search.length === 0 ? (
        <p>
          No matches for <i>&quot;{query}&quot;</i>
        </p>
      ) : null}
      {search.map((result) => {
        const key = `${result.__typename}:${result.id}`;
        switch (result.__typename) {
          case 'Post':
            return <PostResult key={key} result={result} />;
          case 'User':
            return <UserResult key={key} result={result} />;
        }
        return null;
      })}
    </VStack>
  );
};

const CommentResult = ({ comment: commentRef }: { comment: ViewRef<'Comment'> }) => {
  const comment = useView(CommentSearchView, commentRef);
  const post = useView(CommentPostView, comment.post);

  return <CommentCard comment={comment} link post={post} />;
};

const SearchResults = ({ isStale, query }: { isStale: boolean; query: string }) => {
  const { commentSearch } = useRequest({
    commentSearch: { args: { query }, list: CommentSearchView },
  });

  if (commentSearch.length === 0) {
    return (
      <p>
        No matches for <i>&quot;{query}&quot;</i>
      </p>
    );
  }

  return (
    <VStack className={cx(isStale && 'opacity-50')} gap={12}>
      {commentSearch.map((comment) => (
        <CommentResult comment={comment} key={comment.id} />
      ))}
    </VStack>
  );
};

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [comments, setComments] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;
  const Results = comments ? SearchResults : MixedSearchResults;

  return (
    <Section>
      <Card>
        <Stack alignCenter between gap={16}>
          <Input
            className="w-64"
            onChange={(e) => setQuery(e.target.value)}
            placeholder={comments ? 'Search comments...' : 'Search posts and users...'}
            ref={(ref) => ref?.focus()}
            value={query}
          />
          {supportsCommentSearch ? (
            <Button onClick={() => setComments(!comments)} size="sm" variant="secondary">
              {comments ? 'Search posts and users' : 'Search comments'}
            </Button>
          ) : null}
          {isDevelopment && comments ? (
            <div className="text-xs text-muted-foreground">500ms artificial slowdown</div>
          ) : null}
        </Stack>

        <ErrorBoundary FallbackComponent={Error}>
          <Suspense fallback={<h2>Thinking…</h2>}>
            {query.trim().length > 0 ? <Results isStale={isStale} query={query} /> : null}
          </Suspense>
        </ErrorBoundary>
      </Card>
    </Section>
  );
}
