import { useParams } from '@void/react';
import { useRequest } from 'react-fate';
import { PostCard, PostView } from '../../src/ui/PostCard.tsx';
import Section from '../../src/ui/Section.tsx';

export default function PostPage() {
  const { id } = useParams<'/post/[id]'>();

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
