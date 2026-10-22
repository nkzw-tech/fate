/**
 * @vitest-environment happy-dom
 */
import {
  clientRoot,
  clientValueRoot,
  createClient,
  mutation,
  view,
  type ViewRef,
} from '@nkzw/fate';
import {
  act,
  Component,
  startTransition,
  StrictMode,
  Suspense,
  useState,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';
import { FateClient, useRequest, useView } from '../index.tsx';

// @ts-expect-error React test environment.
global.IS_REACT_ACT_ENVIRONMENT = true;

test.each([true, false])(
  'retained screens retire deleted query roots and recover rollback (commit: %s)',
  async (commit) => {
    type Lobby = {
      __typename: 'Lobby';
      creator: { __typename: 'User'; id: string };
      id: string;
      slug: string;
    };
    const CardView = view<Lobby>()({ id: true, slug: true });
    const LobbyView = view<Lobby>()({ ...CardView, creator: { id: true } });
    const lobby: Lobby = {
      __typename: 'Lobby',
      creator: { __typename: 'User', id: 'owner' },
      id: '1',
      slug: 'lobby',
    };
    const response = Promise.withResolvers<Partial<Lobby>>();
    const home = Promise.withResolvers<string>();
    const roots = {
      home: clientValueRoot<string>(),
      lobby: clientRoot<Lobby | null, 'Lobby'>('Lobby'),
    };
    const mutations = { remove: mutation<Lobby, { id: string }, Partial<Lobby>>('Lobby') };
    const fetchQuery = vi.fn(async (name: string) => (name === 'home' ? home.promise : lobby));
    const client = createClient<[typeof roots, typeof mutations]>({
      mutations,
      roots,
      transport: {
        fetchById: async () => [],
        fetchQuery,
        mutate: vi.fn().mockReturnValue(response.promise),
      },
      types: [{ fields: { creator: { type: 'User' } }, type: 'Lobby' }, { type: 'User' }],
    });
    const errors: Array<Error> = [];
    class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      override state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      override componentDidCatch(error: Error) {
        errors.push(error);
      }
      override render() {
        return this.state.failed ? 'Boundary' : this.props.children;
      }
    }
    const Card = ({ card }: { card: ViewRef<'Lobby'> }) => (
      <span>{useView(CardView, card).slug}</span>
    );
    const homeRequest = { home: { value: true as const } };
    const Home = () => (
      <span>{useRequest<typeof homeRequest, typeof roots>(homeRequest).home}</span>
    );
    const lobbyRequest = { lobby: { view: LobbyView } };
    const LobbyPage = () => {
      const { lobby } = useRequest<typeof lobbyRequest, typeof roots>(lobbyRequest, {
        mode: 'network-only',
      });
      const data = useView(LobbyView, lobby);
      return data && lobby ? (
        <>
          <span>{data.creator.id}</span>
          <Card card={lobby} />
        </>
      ) : (
        'Deleted'
      );
    };
    let navigate!: () => void;
    const App = () => {
      const [isHome, setHome] = useState(false);
      navigate = () => setHome(true);
      return <Suspense fallback="Loading">{isHome ? <Home /> : <LobbyPage />}</Suspense>;
    };
    const element = document.createElement('div');
    const root = createRoot(element);
    let deletion: Promise<unknown> | undefined;
    try {
      await act(async () =>
        root.render(
          <StrictMode>
            <FateClient client={client}>
              <Boundary>
                <App />
              </Boundary>
            </FateClient>
          </StrictMode>,
        ),
      );
      expect(element.textContent).toBe('ownerlobby');
      await act(async () => {
        deletion = client.mutations
          .remove({ delete: true, input: { id: lobby.id } })
          .catch(() => undefined);
      });
      expect(element.textContent).toBe('Deleted');
      await act(async () => {
        if (commit) {
          response.resolve({ id: lobby.id });
        } else {
          response.reject(new Error('Cannot delete'));
        }
        await deletion;
        if (commit) {
          startTransition(navigate);
        }
      });
      expect(element.textContent).toBe(commit ? 'Deleted' : 'ownerlobby');
      expect(errors).toEqual([]);
      expect(fetchQuery.mock.calls.filter(([name]) => name === 'lobby')).toHaveLength(1);
      if (commit) {
        await act(async () => {
          home.resolve('Home');
        });
        expect(element.textContent).toBe('Home');
      }
    } finally {
      response.resolve({ id: lobby.id });
      home.resolve('Home');
      await act(async () => {
        await deletion;
        root.unmount();
      });
    }
  },
);
