import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  channelName,
  isAppMessage,
  pageIdGlobal,
  type ClientSnapshot,
  type ClientSummary,
  type DevtoolsAction,
  type PanelMessage,
} from '../src/protocol.ts';

const watchInterval = 2000;
const panelId = Math.random().toString(36).slice(2, 10);

/** The page id of the app that embeds this panel (Vite DevTools dock or popup). */
const getHostPageId = (): string | undefined => {
  for (const host of [window.parent !== window ? window.parent : null, window.opener]) {
    try {
      const id = host?.[pageIdGlobal as keyof Window];
      if (typeof id === 'string') {
        return id;
      }
    } catch {
      // Cross-origin hosts cannot be inspected.
    }
  }
  return undefined;
};

export type DevtoolsConnection = Readonly<{
  clients: ReadonlyArray<ClientSummary>;
  hostPageId: string | undefined;
  run: (action: DevtoolsAction) => void;
  select: (id: string) => void;
  selectedId: string | null;
  snapshot: ClientSnapshot | null;
}>;

export default function useDevtools(): DevtoolsConnection {
  const channel = useMemo(() => new BroadcastChannel(channelName), []);
  const [clients, setClients] = useState<ReadonlyArray<ClientSummary>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, ClientSnapshot>>(() => new Map());
  const [hostPageId, setHostPageId] = useState(getHostPageId);

  const post = useCallback((message: PanelMessage) => channel.postMessage(message), [channel]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!isAppMessage(message)) {
        return;
      }
      switch (message.type) {
        case 'connected':
          setHostPageId((current) => current ?? getHostPageId());
          setClients((current) =>
            current.some(({ id }) => id === message.client.id)
              ? current
              : [...current, message.client],
          );
          break;
        case 'disconnected':
          setClients((current) => current.filter(({ id }) => id !== message.clientId));
          setSnapshots((current) => {
            const next = new Map(current);
            next.delete(message.clientId);
            return next;
          });
          break;
        case 'snapshot':
          setSnapshots((current) => new Map(current).set(message.snapshot.id, message.snapshot));
          break;
      }
    };
    channel.addEventListener('message', onMessage);
    post({ source: 'fate-devtools:panel', type: 'discover' });
    return () => {
      channel.removeEventListener('message', onMessage);
      channel.close();
    };
  }, [channel, post]);

  // Prefer the newest client of the page this panel is embedded in.
  const preferred = useMemo(() => {
    const own = clients.filter(({ pageId }) => pageId === hostPageId);
    return (own.length ? own : clients).at(-1)?.id ?? null;
  }, [clients, hostPageId]);

  const activeId =
    selectedId && clients.some(({ id }) => id === selectedId) ? selectedId : preferred;

  useEffect(() => {
    if (!activeId) {
      return;
    }
    const watch = () =>
      post({ clientId: activeId, panelId, source: 'fate-devtools:panel', type: 'watch' });
    watch();
    const interval = setInterval(watch, watchInterval);
    return () => {
      clearInterval(interval);
      post({ clientId: activeId, panelId, source: 'fate-devtools:panel', type: 'unwatch' });
    };
  }, [activeId, post]);

  const run = useCallback(
    (action: DevtoolsAction) => {
      if (activeId) {
        post({ action, clientId: activeId, source: 'fate-devtools:panel', type: 'action' });
      }
    },
    [activeId, post],
  );

  return {
    clients,
    hostPageId,
    run,
    select: setSelectedId,
    selectedId: activeId,
    snapshot: (activeId && snapshots.get(activeId)) || null,
  };
}
