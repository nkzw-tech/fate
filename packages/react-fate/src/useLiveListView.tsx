import { isDeferred, type Deferred, type DeferredSnapshot } from '@nkzw/fate';
import { use, useEffect, useEffectEvent } from 'react';
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
  const resolvedConnection = (
    isDeferred(connection)
      ? (
          use(
            client.readDeferred(connection as Deferred<ConnectionValue | null | undefined>),
          ) as DeferredSnapshot<ConnectionValue | null | undefined>
        ).data
      : (connection as ConnectionValue | null | undefined)
  ) as ConnectionValue | null | undefined;
  const { metadata, nodeView } = useListViewInfo(selection, resolvedConnection);

  const subscribeLiveListView = useEffectEvent(() => {
    if (!metadata) {
      return;
    }

    client.assertLiveConnectionSupport();
    return client.subscribeLiveListView(nodeView, metadata);
  });

  useEffect(() => subscribeLiveListView(), [client, metadata?.key, nodeView]);

  return useListView(selection, resolvedConnection) as [
    ConnectionItems<ResolvedConnection<C>>,
    LoadMoreFn | null,
    LoadMoreFn | null,
  ];
}
