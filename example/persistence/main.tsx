import { Badge } from '@nkzw/fate-client/ui/Badge';
import { Button } from '@nkzw/fate-client/ui/Button';
import Card from '@nkzw/fate-client/ui/Card';
import H2 from '@nkzw/fate-client/ui/H2';
import H3 from '@nkzw/fate-client/ui/H3';
import Input, { CheckBox } from '@nkzw/fate-client/ui/Input';
import Section from '@nkzw/fate-client/ui/Section';
import { createIndexedDBStorage } from '@nkzw/fate-indexeddb';
import { createPersistence } from '@nkzw/fate/persistence';
import { Component, type ReactNode, Suspense, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import {
  clientRoot,
  createClient,
  createHTTPTransport,
  FateClient,
  mutation,
  useListView,
  useRequest,
  useView,
  view,
  type ViewRef,
} from 'react-fate';
import type { Note } from './model.ts';
import './style.css';

const account = new URLSearchParams(location.search).get('account') === 'bob' ? 'bob' : 'alice';
let offline = sessionStorage.getItem('offline') === 'true';
let loseResponse = false;
const transport = createHTTPTransport<{
  mutations: {
    like: { input: { id: string }; output: Note };
    remove: { input: { id: string }; output: null };
    save: { input: { id: string; title: string }; output: Note };
  };
}>({
  async fetch(url, init) {
    if (offline) {
      throw new TypeError('Offline');
    }
    const response = await fetch(url, init);
    if (loseResponse && String(init?.body).includes('"mutation"')) {
      loseResponse = false;
      // The server has committed. Drop only its response to exercise deduplication.
      await response.text();
      throw new TypeError('Response lost after server commit');
    }
    return response;
  },
  headers: { 'x-example-account': account },
  live: false,
  url: '/api/fate',
});
const roots = { notes: clientRoot('Note') };
const mutations = {
  like: mutation<Note, { id: string }, Note>('Note'),
  remove: mutation<Note, { id: string }, null>('Note'),
  save: mutation<Note, { id: string; title: string }, Note>('Note'),
};
const client = createClient<[typeof roots, typeof mutations]>({
  mutations,
  persistence: createPersistence({
    key: `notes:${account}`,
    maxAge: 24 * 60 * 60 * 1000,
    maxBytes: 25 * 1024 * 1024,
    online: () => !offline && navigator.onLine,
    storage: createIndexedDBStorage(),
  }),
  roots,
  transport,
  types: [{ fields: { likes: 'scalar', title: 'scalar' }, type: 'Note' }],
});
const session = client.persistence!;
const NoteView = view<Note>()({ id: true, likes: true, title: true });
const NotesView = {
  items: { cursor: true, node: NoteView },
  pagination: { hasNext: true, hasPrevious: true },
} as const;
const request = { notes: { list: NotesView } };

function NoteRow({ noteRef, report }: { noteRef: ViewRef<'Note'>; report(message: string): void }) {
  const note = useView(NoteView, noteRef);
  if (!note) {
    return null;
  }
  const handle = (promise: ReturnType<typeof client.mutations.like>) => {
    void promise
      .then(({ error }) => {
        if (error) {
          report(error.message);
        }
      })
      .catch((error: Error) => report(error.message));
  };
  return (
    <li>
      <Card>
        <H3>{note.title}</H3>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary">{note.likes} likes</Badge>
          <Button
            onClick={() =>
              handle(
                client.mutations.like({
                  input: { id: note.id },
                  optimistic: { likes: note.likes + 1 },
                }),
              )
            }
            type="button"
            variant="secondary"
          >
            Like
          </Button>
          <Button
            onClick={() => {
              void client.mutations
                .remove({ delete: true, input: { id: note.id } })
                .catch((error: Error) => report(error.message));
            }}
            type="button"
            variant="secondary"
          >
            Delete
          </Button>
        </div>
      </Card>
    </li>
  );
}

function Notes({ report }: { report(message: string): void }) {
  const { notes } = useRequest<typeof request, typeof roots>(request, {
    mode: 'stale-while-revalidate',
    persist: { maxAge: 3 * 24 * 60 * 60 * 1000 },
  });
  const [items] = useListView(NotesView, notes);
  return (
    <ul className="grid gap-6 sm:grid-cols-2">
      {items.map(({ node }) =>
        node ? <NoteRow key={node.id} noteRef={node} report={report} /> : null,
      )}
    </ul>
  );
}

class RequestBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error ? (
      <p className="flex flex-wrap items-center gap-3 text-sm text-destructive" role="alert">
        {this.state.error.message}{' '}
        <Button onClick={() => this.setState({ error: null })} type="button" variant="secondary">
          Retry reads
        </Button>
      </p>
    ) : (
      this.props.children
    );
  }
}

function App() {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [isOffline, setOffline] = useState(offline);
  const [message, setMessage] = useState('');
  return (
    <FateClient client={client}>
      <div className="min-h-screen bg-background text-foreground">
        <div className="min-h-screen bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_80%_0,rgba(99,102,241,0.08),transparent_28%)]">
          <header className="sticky top-0 z-50 border-b border-white/60 bg-white/60 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/70">
            <div className="container mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 lg:px-8">
              <a
                className="bg-linear-to-r from-gray-500 to-gray-900 bg-clip-text text-xl font-semibold text-transparent italic dark:from-gray-200 dark:to-white"
                href="/"
              >
                fate
              </a>
            </div>
          </header>
          <main>
            <Section className="max-w-5xl" gap={32}>
              <Card className="border border-white/20 bg-linear-to-r from-blue-500 to-sky-500 text-white dark:from-blue-600 dark:to-sky-600">
                <span className="squircle self-start bg-white/20 px-2 py-1 text-xs font-semibold tracking-widest uppercase">
                  <span className="lowercase italic">fate</span> persistence
                </span>
                <h1 className="text-3xl leading-tight font-semibold text-balance lg:text-4xl">
                  Your work survives the network.
                </h1>
                <p className="text-sm text-white/80 lg:text-base">
                  Add a note, go offline, then like it and reload. Reconnect to deliver the queue.
                  Each Like increments the SQLite counter once, even when its response is lost.
                </p>
              </Card>
              <Card>
                <H3>Connection controls</H3>
                <section
                  aria-label="Connection controls"
                  className="flex flex-wrap items-center gap-4"
                >
                  <label className="flex items-center gap-2 text-sm">
                    Account{' '}
                    <select
                      className="squircle border-input h-10 border bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      onChange={(event) => {
                        session.dispose();
                        location.search = `account=${event.target.value}`;
                      }}
                      value={account}
                    >
                      <option value="alice">Alice</option>
                      <option value="bob">Bob</option>
                    </select>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <CheckBox
                      checked={isOffline}
                      onChange={(event) => {
                        offline = event.target.checked;
                        sessionStorage.setItem('offline', String(offline));
                        setOffline(offline);
                        session.retry();
                      }}
                      type="checkbox"
                    />{' '}
                    Offline
                  </label>
                  <Button
                    onClick={() => {
                      loseResponse = true;
                      setMessage(
                        'The next mutation response will be lost after the server commits.',
                      );
                    }}
                    type="button"
                    variant="secondary"
                  >
                    Lose next response
                  </Button>
                  <Button
                    onClick={() => {
                      void session
                        .flush()
                        .then(() => location.reload())
                        .catch((error: Error) => setMessage(error.message));
                    }}
                    type="button"
                    variant="secondary"
                  >
                    Reload
                  </Button>
                  <Button
                    disabled={isOffline}
                    onClick={() => {
                      void client
                        .request(request, { mode: 'network-only' })
                        .then(() => setMessage('Server state refreshed.'))
                        .catch((error: Error) => setMessage(error.message));
                    }}
                    type="button"
                    variant="secondary"
                  >
                    Refresh from server
                  </Button>
                </section>
              </Card>
              <Card>
                <H3>Create a note</H3>
                <form
                  className="flex flex-wrap items-center gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const data = new FormData(form);
                    const input = { id: crypto.randomUUID(), title: String(data.get('title')) };
                    void client.mutations
                      .save({
                        input,
                        optimistic: { ...input, likes: 0 },
                        persist: data.get('transient') !== 'on',
                      })
                      .then(({ error }) => {
                        if (error) {
                          setMessage(error.message);
                        }
                      })
                      .catch((error: Error) => setMessage(error.message));
                    form.reset();
                  }}
                >
                  <Input
                    aria-label="Note title"
                    className="min-w-0 flex-1 basis-56"
                    name="title"
                    placeholder="A note to keep…"
                    required
                  />
                  <Button type="submit" variant="secondary">
                    Add note
                  </Button>
                  <label className="flex w-full cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                    <CheckBox name="transient" /> Skip persistence for this call
                  </label>
                </form>
              </Card>
              <p className="text-sm text-muted-foreground" role="status">
                {snapshot.status} ·{' '}
                {snapshot.mutations.filter((entry) => entry.status !== 'failed').length} pending{' '}
                {message && `· ${message}`}
              </p>
              {snapshot.error && (
                <p className="text-sm text-destructive" role="alert">
                  {snapshot.error.message}
                </p>
              )}
              {snapshot.status === 'ready' && (
                <section aria-label="Notes" className="space-y-4">
                  <H2 className="pl-5">Notes</H2>
                  <RequestBoundary>
                    <Suspense
                      fallback={
                        <p className="px-5 text-sm text-muted-foreground">Loading notes…</p>
                      }
                    >
                      <Notes report={setMessage} />
                    </Suspense>
                  </RequestBoundary>
                </section>
              )}
              {snapshot.mutations.length > 0 && (
                <aside>
                  <Card>
                    <H3>Pending delivery</H3>
                    {snapshot.mutations.map((entry) => (
                      <p
                        className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
                        key={entry.id}
                      >
                        {entry.name} · {entry.status} {entry.error && `· ${entry.error}`}{' '}
                        {entry.status === 'failed' && (
                          <Button
                            onClick={() => {
                              void session.discard(entry.id);
                            }}
                            type="button"
                            variant="secondary"
                          >
                            Dismiss
                          </Button>
                        )}
                      </p>
                    ))}
                  </Card>
                </aside>
              )}
            </Section>
          </main>
        </div>
      </div>
    </FateClient>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
import.meta.hot?.dispose(() => session.dispose());
