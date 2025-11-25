import type { Category, Post } from '@nkzw/fate-server/src/trpc/views.ts';
import Stack, { VStack } from '@nkzw/stack';
import { useView, view, ViewRef } from 'react-fate';
import { Link } from 'react-router';
import { Badge } from '../ui/Badge.tsx';
import Card from '../ui/Card.tsx';
import TagBadge, { TagView } from '../ui/TagBadge.tsx';
import { UserView } from '../ui/UserCard.tsx';

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
          <span className="font-medium text-sky-700 hover:underline">
            {post.title}
          </span>
        </Link>
        <span className="text-muted-foreground text-xs">
          {post.likes} likes
        </span>
      </Stack>
      <Stack alignCenter gap={8} wrap>
        <span className="text-muted-foreground text-xs">
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

export default function CategoryCard({
  category: categoryRef,
}: {
  category: ViewRef<'Category'>;
}) {
  const category = useView(CategoryView, categoryRef);
  const posts = category.posts?.items ?? [];

  return (
    <Card key={category.id}>
      <VStack gap={12}>
        <Stack alignCenter between gap={12}>
          <div>
            <Link to={`/category/${category.id}`}>
              <h4 className="text-lg font-semibold text-blue-700 hover:underline">
                {category.name}
              </h4>
            </Link>
            <p className="text-muted-foreground text-sm">
              {category.description}
            </p>
          </div>
          <Badge className="text-nowrap" variant="outline">
            {category.postCount} posts
          </Badge>
        </Stack>
        <VStack gap={12}>
          {posts.map(({ cursor, node }) => {
            if (cursor !== node.id) {
              throw new Error(
                `fate: Cursor '${cursor}' does not match node ID '${node.id}'.`,
              );
            }
            return <CategoryPost key={node.id} post={node} />;
          })}
        </VStack>
        {category.posts?.pagination?.hasNext ? (
          <span className="text-muted-foreground text-sm">
            More posts available in this category...
          </span>
        ) : null}
      </VStack>
    </Card>
  );
}
