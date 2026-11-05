import { type Deferred } from '@nkzw/fate';
import { useEffect, useEffectEvent } from 'react';
import { useFateClient } from './context.tsx';
import {
  useListViewInfo,
  type ConnectionItems,
  type ConnectionSelection,
  type ConnectionValue,
  type ResolvedConnection,
  type LoadMoreFn,
} from './listView.ts';
import { useListView } from './useListView.tsx';
import { useDeferredValueSnapshot } from './useViewSnapshots.ts';

/**
 * Subscribes to a connection field, returning live-updating items and pagination
 * helpers to load the next or previous page. Nullish connections return undefined items.
 */
export function useLiveListView<
  C extends ConnectionValue | Deferred<ConnectionValue | null | undefined> | null | undefined,
>(
  selection: ConnectionSelection,
  connection: C,
): [ConnectionItems<ResolvedConnection<C>>, LoadMoreFn | null, LoadMoreFn | null] {
  const client = useFateClient();
  const resolvedConnection = useDeferredValueSnapshot<ConnectionValue | null | undefined>(
    connection,
  );
  const { metadata, nodeView } = useListViewInfo(selection, resolvedConnection);

  const subscribeLiveListView = useEffectEvent(() => {
    if (!metadata) {
      return;
    }

    client.assertLiveConnectionSupport();
    return client.subscribeLiveListView(nodeView, metadata);
  });

  useEffect(() => subscribeLiveListView(), [client, metadata?.key, metadata?.windowKey, nodeView]);

  return useListView(selection, resolvedConnection) as [
    ConnectionItems<ResolvedConnection<C>>,
    LoadMoreFn | null,
    LoadMoreFn | null,
  ];
}
