import { useRequest } from 'react-fate';
import CategoryCard, { CategoryView } from '../../src/ui/CategoryCard.tsx';
import Section from '../../src/ui/Section.tsx';
import type { Props } from './[id].server.ts';

export default function CategoryPage({ id }: Props) {
  if (!id) {
    throw new Error('fate: Category ID is required.');
  }

  const { category } = useRequest(
    { category: { id, view: CategoryView } },
    { mode: 'stale-while-revalidate' },
  );

  return (
    <Section>
      <CategoryCard category={category} />
    </Section>
  );
}
