export default function getMixedSearchPage(
  posts: Array<{ id: string }>,
  users: Array<{ id: string }>,
  cursor: string | undefined,
  direction: 'backward' | 'forward',
  take: number,
) {
  const entries = [
    ...posts.map(({ id }) => ({ __typename: 'Post' as const, cursor: `Post:${id}`, id })),
    ...users.map(({ id }) => ({ __typename: 'User' as const, cursor: `User:${id}`, id })),
  ].sort((a, b) => a.id.localeCompare(b.id) || a.cursor.localeCompare(b.cursor));
  const index = entries.findIndex((entry) => entry.cursor === cursor);
  return direction === 'backward'
    ? entries.slice(0, index < 0 ? entries.length : index).slice(-take)
    : entries.slice(index + 1, index + 1 + take);
}
