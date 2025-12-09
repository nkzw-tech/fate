import Stack, { VStack } from '@nkzw/stack';
import { KeyboardEvent, startTransition, useActionState, useState } from 'react';
import { useFateClient, useView, ViewRef } from 'react-fate';
import { Button } from '../ui/Button.tsx';
import Card from './Card.tsx';
import H3 from './H3.tsx';
import Input from './Input.tsx';
import { PostView } from './PostCard.tsx';
import { UserCardView } from './UserCard.tsx';

export default function CreatePost({ user: userRef }: { user: ViewRef<'User'> | null }) {
  const fate = useFateClient();
  const user = useView(UserCardView, userRef);
  const [contentValue, setContentValue] = useState('');
  const [titleValue, setTitleValue] = useState('');

  const [, createPost, isPending] = useActionState(async () => {
    const content = contentValue.trim();
    const title = titleValue.trim();

    if (!content || !title || !user) {
      return;
    }

    const result = await fate.mutations.post.add({
      input: { content, title },
      insert: 'before',
      optimistic: {
        author: user,
        comments: [],
        content,
        id: `optimistic:${Date.now().toString(36)}`,
        title,
      },
      view: PostView,
    });

    setContentValue('');
    setTitleValue('');

    return result;
  }, null);

  const maybeSubmitPost = (event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      startTransition(createPost);
    }
  };

  const commentingIsDisabled =
    isPending || titleValue.trim().length === 0 || contentValue.trim().length === 0;

  return (
    <Card>
      <VStack action={createPost} as="form" gap={16}>
        <H3>Create a Post</H3>
        <Input
          className="w-full"
          disabled={isPending}
          onChange={(event) => setTitleValue(event.target.value)}
          onKeyDown={maybeSubmitPost}
          placeholder="Post Title"
          value={titleValue}
        />
        <textarea
          className="squircle border-input flex min-h-20 w-full border bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-900/40"
          disabled={isPending}
          onChange={(event) => setContentValue(event.target.value)}
          onKeyDown={maybeSubmitPost}
          placeholder={'Share your thoughts about fate...'}
          value={contentValue}
        />
        <Stack end gap>
          <Button disabled={commentingIsDisabled} size="sm" type="submit" variant="secondary">
            Post comment
          </Button>
        </Stack>
      </VStack>
    </Card>
  );
}
