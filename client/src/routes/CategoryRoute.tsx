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
        ids: [id],
        root: CategoryView,
        type: 'Category',
      },
    } as const,
    { mode: 'store-and-network' },
  );

  return (
    <Section>
      <CategoryCard category={category[0]} />
    </Section>
  );
}
