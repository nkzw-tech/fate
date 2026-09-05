/**
 * @vitest-environment happy-dom
 */

import { createClient, mutation, view, type FateRoots } from '@nkzw/fate';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';
import { FateClient } from '../context.tsx';
import { useView } from '../useView.tsx';

// @ts-expect-error React test environment flag.
global.IS_REACT_ACT_ENVIRONMENT = true;

test('pending mutations rerender only views whose selected values change', async () => {
  type User = { __typename: 'User'; id: string; name: string; score: number };
  const response = Promise.withResolvers<Partial<User>>();
  const mutations = { edit: mutation<User, { id: string }, Partial<User>>('User') };
  const client = createClient<[FateRoots, typeof mutations]>({
    mutations,
    roots: {},
    transport: { fetchById: async () => [], mutate: vi.fn().mockReturnValue(response.promise) },
    types: [{ type: 'User' }],
  });
  client.write('User', { id: '1', name: 'Initial', score: 0 }, new Set(['id', 'name', 'score']));
  const NameView = view<User>()({ name: true });
  const ScoreView = view<User>()({ score: true });
  const nameRef = client.ref('User', '1', NameView);
  const scoreRef = client.ref('User', '1', ScoreView);
  const nameRendered = vi.fn();
  const scoreRendered = vi.fn();
  const Name = () => {
    nameRendered();
    return <span>{useView(NameView, nameRef).name}</span>;
  };
  const Score = () => {
    scoreRendered();
    return <span>{useView(ScoreView, scoreRef).score}</span>;
  };
  const pending = client.mutations
    .edit({ input: { id: '1' }, optimistic: { name: 'Pending' } })
    .catch(() => undefined);
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <FateClient client={client}>
          <Name />
          <Score />
        </FateClient>,
      ),
    );
    nameRendered.mockClear();
    scoreRendered.mockClear();
    await act(async () => {
      for (let index = 0; index < 20; index++) {
        client.write('User', { id: 'other', name: String(index) }, new Set(['id', 'name']));
      }
    });
    expect(nameRendered).not.toHaveBeenCalled();
    expect(scoreRendered).not.toHaveBeenCalled();
    await act(async () => client.write('User', { id: '1', score: 5 }, new Set(['id', 'score'])));
    expect(nameRendered).not.toHaveBeenCalled();
    expect(scoreRendered).toHaveBeenCalled();
    scoreRendered.mockClear();
    await act(async () => {
      response.reject(new Error('failed'));
      await pending;
    });
    expect(nameRendered).toHaveBeenCalled();
    expect(scoreRendered).not.toHaveBeenCalled();
    expect(container.textContent).toBe('Initial5');
  } finally {
    response.reject(new Error('cleanup'));
    await act(async () => {
      await pending;
      root.unmount();
    });
  }
});
