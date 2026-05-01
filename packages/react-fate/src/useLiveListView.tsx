import type { Pagination } from '@nkzw/fate';
import { useEffect, useEffectEvent } from 'react';
import { useFateClient } from './context.tsx';
import {
  useListViewInfo,
  type ConnectionItems,
  type ConnectionSelection,
  type LoadMoreFn,
} from './listView.ts';
import { useListView } from './useListView.tsx';

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
  const { metadata, nodeView } = useListViewInfo(selection, connection);

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
