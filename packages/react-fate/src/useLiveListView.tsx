import { ConnectionMetadata, ConnectionTag, isViewTag, Pagination, type View } from '@nkzw/fate';
import { useEffect, useEffectEvent, useMemo } from 'react';
import { useFateClient } from './context.tsx';
import { useListView } from './useListView.tsx';

type ConnectionItems<C> = C extends { items?: ReadonlyArray<infer Item> }
  ? ReadonlyArray<Item>
  : ReadonlyArray<never>;

type LoadMoreFn = () => Promise<void>;

type ConnectionSelection = { items?: { node?: unknown } };

const getNodeView = (view: ConnectionSelection) => {
  const maybeView = (view as ConnectionSelection)?.items?.node;

  if (maybeView) {
    for (const key of Object.keys(maybeView)) {
      if (isViewTag(key)) {
        return maybeView as View<any, any>;
      }
    }
  }

  return view as View<any, any>;
};

/**
 * Subscribes to a connection field, returning live-updating items and pagination
 * helpers to load the next or previous page.
 */
export function useLiveListView<
  C extends { items?: ReadonlyArray<any>; pagination?: Pagination } | null | undefined,
>(
  selection: ConnectionSelection,
  connection: C,
): [ConnectionItems<NonNullable<C>>, LoadMoreFn | null, LoadMoreFn | null] {
  const client = useFateClient();
  const nodeView = useMemo(() => getNodeView(selection), [selection]);
  const metadata =
    connection && typeof connection === 'object'
      ? ((connection as Record<symbol, unknown>)[ConnectionTag] as ConnectionMetadata | undefined)
      : null;

  const subscribeLiveListView = useEffectEvent(() => {
    if (!metadata) {
      return;
    }

    client.assertLiveConnectionSupport();
    return client.subscribeLiveListView(nodeView, metadata);
  });

  useEffect(() => subscribeLiveListView(), [client, metadata?.key, nodeView]);

  return useListView(selection, connection);
}
