import { useRequest } from 'react-fate';
import { PostCard, PostView } from '../../src/ui/PostCard.tsx';
import Section from '../../src/ui/Section.tsx';
import type { Props } from './[id].server.ts';

export default function PostPage({ id }: Props) {
  if (!id) {
    throw new Error('fate: Post ID is required.');
  }

  const { post } = useRequest({
    post: { id, view: PostView },
  });

  return (
    <Section>
      <PostCard detail post={post} />
    </Section>
  );
}
