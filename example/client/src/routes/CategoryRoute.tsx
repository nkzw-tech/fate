import { useRequest } from 'react-fate';
import { useParams } from 'react-router';
import CategoryCard, { CategoryView } from '../ui/CategoryCard.tsx';
import Section from '../ui/Section.tsx';

export default function CategoryRoute() {
  const { id } = useParams();

  if (!id) {
    throw new Error('fate: Category ID is required.');
  }

  const { category } = useRequest(
    {
      category: {
        id,
        type: 'Category',
        view: CategoryView,
      },
    } as const,
    { mode: 'stale-while-revalidate' },
  );

  return (
    <Section>
      <CategoryCard category={category} />
    </Section>
  );
}
