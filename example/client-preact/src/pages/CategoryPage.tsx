import { useRequest } from 'preact-fate';
import { useRoute } from 'preact-iso/router';
import CategoryCard, { CategoryView } from '../ui/CategoryCard.tsx';
import Section from '../ui/Section.tsx';

export default function CategoryPage() {
  const { id } = useRoute().params as { id?: string };

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
