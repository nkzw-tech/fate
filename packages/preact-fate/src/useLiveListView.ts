import { isDeferred, type Deferred, type DeferredSnapshot, type Pagination } from '@nkzw/fate';
import { useEffect } from 'preact/hooks';
import { useFateClient } from './context.ts';
import { useEffectEvent, useThenable } from './hooks.ts';
import {
  useListViewInfo,
  type ConnectionItems,
  type ConnectionSelection,
  type LoadMoreFn,
} from './listView.ts';
import { useListView } from './useListView.ts';

type ConnectionValue = { items?: ReadonlyArray<any>; pagination?: Pagination };
type ResolvedConnection<C> = C extends Deferred<infer Value> ? Value : NonNullable<C>;

/**
 * Subscribes to a connection field, returning live-updating items and pagination
 * helpers to load the next or previous page.
 */
export function useLiveListView<
  C extends ConnectionValue | Deferred<ConnectionValue> | null | undefined,
>(
  selection: ConnectionSelection,
  connection: C,
): [ConnectionItems<ResolvedConnection<C>>, LoadMoreFn | null, LoadMoreFn | null] {
  const client = useFateClient();
  const deferredSnapshot = useThenable(
    isDeferred(connection) ? client.readDeferred(connection as Deferred<ConnectionValue>) : null,
  ) as DeferredSnapshot<ConnectionValue> | undefined;
  const resolvedConnection = (deferredSnapshot ? deferredSnapshot.data : connection) as
    | ConnectionValue
    | null
    | undefined;
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
