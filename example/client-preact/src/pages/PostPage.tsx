import { useRequest } from 'preact-fate';
import { useRoute } from 'preact-iso/router';
import { PostCard, PostView } from '../ui/PostCard.tsx';
import Section from '../ui/Section.tsx';

export default function PostPage() {
  const { id } = useRoute().params as { id?: string };

  if (!id) {
    throw new Error('fate: Post ID is required.');
  }

  const { post } = useRequest({ post: { id, view: PostView } });

  return (
    <Section>
      <PostCard detail post={post} />
    </Section>
  );
}
