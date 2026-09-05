import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vite-plus/test';
import Layout from '../pages/layout.tsx';

const session = vi.hoisted(() => ({
  data: null as { user: { id: string } } | null,
  isPending: false,
}));

vi.mock('../src/user/AuthClient.tsx', () => ({
  default: { useSession: () => session },
}));
vi.mock('../src/ui/Header.tsx', () => ({ default: () => null }));
vi.mock('../src/lib/env.tsx', () => ({ default: () => 'http://localhost:9020' }));
vi.mock('react-fate/client', () => ({ createFateClient: () => ({}) }));

test.each([
  { data: null, isPending: true, name: 'checking the session', showContent: false },
  { data: null, isPending: false, name: 'signed out', showContent: true },
  {
    data: { user: { id: 'user-1' } },
    isPending: false,
    name: 'signed in',
    showContent: true,
  },
])('renders the correct content when $name', ({ data, isPending, showContent }) => {
  Object.assign(session, { data, isPending });

  const html = renderToStaticMarkup(
    <Layout>
      <main>Page content</main>
    </Layout>,
  );

  expect(html.includes('Page content')).toBe(showContent);
  expect(html.includes('Thinking...')).toBe(!showContent);
});
