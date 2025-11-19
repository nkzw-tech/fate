import { Tag } from '@nkzw/fate-server/src/trpc/router.ts';
import { useView, view, ViewRef } from 'react-fate';
import { Badge } from './Badge.tsx';

export const TagView = view<Tag>()({
  description: true,
  id: true,
  name: true,
});

export default function TagBadge({ tag: tagRef }: { tag: ViewRef<'Tag'> }) {
  const tag = useView(TagView, tagRef);

  if (!tag) {
    return null;
  }

  return (
    <Badge
      className="bg-secondary/70 text-secondary-foreground"
      variant="secondary"
    >
      #{tag.name}
    </Badge>
  );
}
