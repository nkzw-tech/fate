import { useRequest } from 'react-fate';
import { useParams } from 'react-router';
import { PostCard, PostView } from '../ui/PostCard.tsx';
import Section from '../ui/Section.tsx';

export default function PostRoute() {
  const { id } = useParams();

  if (!id) {
    throw new Error('fate: Post ID is required.');
  }

  const { post } = useRequest({
    post: {
      id,
      root: PostView,
      type: 'Post',
    },
  } as const);

  return (
    <Section>
      <PostCard detail post={post} />
    </Section>
  );
}
