import type { Category, Post } from '@nkzw/fate-server/src/trpc/views.ts';
import Stack, { VStack } from '@nkzw/stack';
import { useView, view, ViewRef } from 'react-fate';
import { Link } from 'react-router';
import { Badge } from '../ui/Badge.tsx';
import Card from '../ui/Card.tsx';
import TagBadge, { TagView } from '../ui/TagBadge.tsx';
import { UserView } from '../ui/UserCard.tsx';
import H3 from './H3.tsx';

const CategoryPostView = view<Post>()({
  author: UserView,
  id: true,
  likes: true,
  tags: {
    items: {
      node: TagView,
    },
  },
  title: true,
});

const CategoryPost = ({ post: postRef }: { post: ViewRef<'Post'> }) => {
  const post = useView(CategoryPostView, postRef);
  const author = useView(UserView, post.author);
  const tags = post.tags?.items ?? [];

  return (
    <VStack gap key={post.id}>
      <Stack alignCenter between gap={12}>
        <Link to={`/post/${post.id}`}>
          <span className="font-medium text-blue-600 no-underline hover:underline dark:text-blue-200">
            {post.title}
          </span>
        </Link>
        <span className="text-xs text-muted-foreground">{post.likes} likes</span>
      </Stack>
      <Stack alignCenter gap wrap>
        <span className="text-xs text-muted-foreground">
          {author?.name ? `by ${author.name}` : 'By an anonymous collaborator'}
        </span>
        {tags.length ? (
          <Stack gap wrap>
            {tags.map(({ node }) => (
              <TagBadge key={node.id} tag={node} />
            ))}
          </Stack>
        ) : null}
      </Stack>
    </VStack>
  );
};

export const CategoryView = view<Category>()({
  description: true,
  id: true,
  name: true,
  postCount: true,
  posts: {
    items: {
      cursor: true,
      node: CategoryPostView,
    },
    pagination: {
      hasNext: true,
      nextCursor: true,
    },
  },
});

export default function CategoryCard({ category: categoryRef }: { category: ViewRef<'Category'> }) {
  const category = useView(CategoryView, categoryRef);
  const posts = category.posts?.items ?? [];

  return (
    <Card key={category.id}>
      <VStack gap={12}>
        <Stack alignCenter between gap={12}>
          <div>
            <Link to={`/category/${category.id}`}>
              <H3>{category.name}</H3>
            </Link>
            <p className="text-sm text-muted-foreground">{category.description}</p>
          </div>
          <Badge className="text-nowrap" variant="outline">
            {category.postCount} posts
          </Badge>
        </Stack>
        <VStack gap={12}>
          {posts.map(({ cursor, node }) => {
            if (cursor !== node.id) {
              throw new Error(`fate: Cursor '${cursor}' does not match node ID '${node.id}'.`);
            }
            return <CategoryPost key={node.id} post={node} />;
          })}
        </VStack>
        {category.posts?.pagination?.hasNext ? (
          <span className="text-sm text-muted-foreground">
            More posts available in this category...
          </span>
        ) : null}
      </VStack>
    </Card>
  );
}
