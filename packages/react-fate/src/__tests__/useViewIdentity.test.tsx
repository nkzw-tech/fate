/** @vitest-environment happy-dom */

import { createClient, type Transport, view, type ViewRef } from '@nkzw/fate';
import { act, startTransition, Suspense, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';
import { FateClient, useView, useViews } from '../index.tsx';

// @ts-expect-error React test environment.
global.IS_REACT_ACT_ENVIRONMENT = true;

type User = { __typename: 'User'; id: string; name: string };
const UserView = view<User>()({ id: true, name: true });
const setup = (label = '') => {
  const fetchById = vi.fn<Transport['fetchById']>(async () => []);
  const client = createClient({ roots: {}, transport: { fetchById }, types: [{ type: 'User' }] });
  for (const id of ['A', 'B']) {
    client.write('User', { id, name: `${label}${id}` }, new Set(['id', 'name']));
  }
  return { client, fetchById };
};
type Ref = ViewRef<'User'> | null | undefined;
const idOf = (ref: Ref) => (ref == null ? ref : String(ref.id));

test('useView commits the current ref through absence and cached identity changes', async () => {
  const { client, fetchById } = setup();
  const a = client.ref('User', 'A', UserView);
  const b = client.ref('User', 'B', UserView);
  const commits: Array<{ actual: string | null | undefined; expected: string | null | undefined }> =
    [];
  function Content({ user }: { user: Ref }) {
    const data = useView(UserView, user);
    useLayoutEffect(() => {
      commits.push({ actual: data == null ? data : data.id, expected: idOf(user) });
    });
    return data?.name;
  }
  const root = createRoot(document.createElement('div'));
  try {
    for (const user of [undefined, a, b, null, a, undefined]) {
      await act(async () =>
        root.render(
          <FateClient client={client}>
            <Content user={user} />
          </FateClient>,
        ),
      );
    }
    for (const { actual, expected } of commits) {
      expect(actual).toEqual(expected);
    }
    expect(fetchById).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});

test('useViews commits current membership, order, duplicates, and nullable positions', async () => {
  const { client, fetchById } = setup();
  const a = client.ref('User', 'A', UserView);
  const b = client.ref('User', 'B', UserView);
  const commits: Array<{ actual: ReadonlyArray<unknown>; expected: ReadonlyArray<unknown> }> = [];
  function Content({ refs }: { refs: ReadonlyArray<Ref> }) {
    const data = useViews(UserView, refs);
    useLayoutEffect(() => {
      commits.push({
        actual: data.map((user) => (user == null ? user : user.id)),
        expected: refs.map(idOf),
      });
    });
    return data.map((user) => user?.name).join(',');
  }
  const root = createRoot(document.createElement('div'));
  const inputs: ReadonlyArray<ReadonlyArray<Ref>> = [
    [],
    [a],
    [a, b],
    [b, a],
    [b, null, undefined, b],
    [],
    [a],
  ];
  try {
    for (const refs of inputs) {
      await act(async () =>
        root.render(
          <FateClient client={client}>
            <Content refs={refs} />
          </FateClient>,
        ),
      );
    }
    for (const { actual, expected } of commits) {
      expect(actual).toEqual(expected);
    }
    expect(fetchById).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});

test.each(['single', 'plural'] as const)(
  '%s readers never commit another client’s data',
  async (kind) => {
    const { client: first } = setup('First ');
    const { client: second } = setup('Second ');
    const ref = first.ref('User', 'A', UserView);
    const singleCommits: Array<{ actual: string; expected: string }> = [];
    const pluralCommits: Array<{ actual: string; expected: string }> = [];
    function Single({ expected }: { expected: string }) {
      const data = useView(UserView, ref);
      useLayoutEffect(() => {
        singleCommits.push({ actual: data.name, expected });
      });
      return data.name;
    }
    function Plural({ expected }: { expected: string }) {
      const data = useViews(UserView, [ref]);
      useLayoutEffect(() => {
        pluralCommits.push({ actual: data[0].name, expected });
      });
      return data[0].name;
    }
    const root = createRoot(document.createElement('div'));
    try {
      for (const [client, expected] of [
        [first, 'First A'],
        [second, 'Second A'],
      ] as const) {
        await act(async () =>
          root.render(
            <FateClient client={client}>
              {kind === 'single' ? <Single expected={expected} /> : <Plural expected={expected} />}
            </FateClient>,
          ),
        );
      }
      for (const { actual, expected } of [...singleCommits, ...pluralCommits]) {
        expect(actual).toBe(expected);
      }
    } finally {
      await act(async () => root.unmount());
    }
  },
);

test.each(['single', 'plural'] as const)(
  '%s readers commit the current parameter binding',
  async (kind) => {
    const Name = view<User>()(({ locale }: { locale: string }) => ({ name: { args: { locale } } }));
    const client = createClient({
      roots: {},
      transport: {
        fetchById: vi.fn<Transport['fetchById']>(async (_, ids, _paths, args) => {
          const parameters = args?.name;
          const name =
            parameters && typeof parameters === 'object' && 'locale' in parameters
              ? parameters.locale
              : undefined;
          return ids.map((id) => ({ id, name }));
        }),
      },
      types: [{ type: 'User' }],
    });
    const en = client.ref('User', 'A', Name({ locale: 'en' }));
    const ja = client.ref('User', 'A', Name({ locale: 'ja' }));
    await Promise.all([client.readView(Name, en), client.readView(Name, ja)]);
    const commits: Array<{ actual: string; expected: string }> = [];
    function Single({ expected, user }: { expected: string; user: ViewRef<'User'> }) {
      const data = useView(Name, user);
      useLayoutEffect(() => {
        commits.push({ actual: data.name, expected });
      });
      return data.name;
    }
    function Plural({ expected, user }: { expected: string; user: ViewRef<'User'> }) {
      const data = useViews(Name, [user]);
      useLayoutEffect(() => {
        commits.push({ actual: data[0].name, expected });
      });
      return data[0].name;
    }
    const root = createRoot(document.createElement('div'));
    try {
      for (const [user, expected] of [
        [en, 'en'],
        [ja, 'ja'],
      ] as const) {
        await act(async () =>
          root.render(
            <FateClient client={client}>
              {kind === 'single' ? (
                <Single expected={expected} user={user} />
              ) : (
                <Plural expected={expected} user={user} />
              )}
            </FateClient>,
          ),
        );
      }
      for (const { actual, expected } of commits) {
        expect(actual).toBe(expected);
      }
    } finally {
      await act(async () => root.unmount());
    }
  },
);

test.each(['single', 'plural'] as const)(
  '%s readers commit the selected view when its input changes',
  async (kind) => {
    const { client } = setup();
    const Identity = view<User>()({ id: true });
    const ref = client.ref('User', 'A', { ...UserView, ...Identity });
    const commits: Array<{ actual: boolean; expected: boolean }> = [];
    function Single({ named }: { named: boolean }) {
      const data = useView(named ? UserView : Identity, ref);
      useLayoutEffect(() => {
        commits.push({ actual: 'name' in data, expected: named });
      });
      return null;
    }
    function Plural({ named }: { named: boolean }) {
      const data = useViews(named ? UserView : Identity, [ref]);
      useLayoutEffect(() => {
        commits.push({ actual: 'name' in data[0], expected: named });
      });
      return null;
    }
    const root = createRoot(document.createElement('div'));
    try {
      for (const named of [true, false]) {
        await act(async () =>
          root.render(
            <FateClient client={client}>
              {kind === 'single' ? <Single named={named} /> : <Plural named={named} />}
            </FateClient>,
          ),
        );
      }
      for (const { actual, expected } of commits) {
        expect(actual).toBe(expected);
      }
    } finally {
      await act(async () => root.unmount());
    }
  },
);

test.each([
  ['single', false],
  ['single', true],
  ['plural', false],
  ['plural', true],
] as const)(
  '%s readers suspend for a missing next identity and retain normal cache updates (transition: %s)',
  async (kind, transition) => {
    const { client, fetchById } = setup();
    const pending = Promise.withResolvers<Array<{ id: string; name: string }>>();
    fetchById.mockReturnValueOnce(pending.promise);
    const a = client.ref('User', 'A', UserView);
    const c = client.ref('User', 'C', UserView);
    const commits: Array<{ actual: string; expected: string }> = [];
    function Single({ user }: { user: ViewRef<'User'> }) {
      const data = useView(UserView, user);
      useLayoutEffect(() => {
        commits.push({ actual: data.id, expected: String(user.id) });
      });
      return <span>{data.name}</span>;
    }
    function Plural({ user }: { user: ViewRef<'User'> }) {
      const data = useViews(UserView, [user]);
      useLayoutEffect(() => {
        commits.push({ actual: data[0].id, expected: String(user.id) });
      });
      return <span>{data[0].name}</span>;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    const render = (user: ViewRef<'User'>) =>
      root.render(
        <FateClient client={client}>
          <Suspense fallback={<p>Loading</p>}>
            {kind === 'single' ? <Single user={user} /> : <Plural user={user} />}
          </Suspense>
        </FateClient>,
      );
    try {
      await act(async () => render(a));
      await act(async () => {
        if (transition) {
          startTransition(() => render(c));
        } else {
          render(c);
        }
      });
      if (transition) {
        expect(container.textContent).toBe('A');
        expect(container.querySelector('p')).toBeNull();
      } else {
        expect(container.querySelector('p')?.textContent).toBe('Loading');
      }
      expect(fetchById).toHaveBeenCalledTimes(1);
      expect(commits.every(({ expected }) => expected === 'A')).toBe(true);
      await act(async () => {
        pending.resolve([{ id: 'C', name: 'Carol' }]);
      });
      expect(container.textContent).toBe('Carol');
      await act(async () => {
        client.write('User', { id: 'C', name: 'Updated' }, new Set(['name']));
      });
      expect(container.textContent).toBe('Updated');
      const count = commits.length;
      await act(async () => {
        client.write('User', { id: 'A', name: 'Removed' }, new Set(['name']));
      });
      expect(commits).toHaveLength(count);
      for (const { actual, expected } of commits) {
        expect(actual).toBe(expected);
      }
    } finally {
      await act(async () => root.unmount());
    }
  },
);
