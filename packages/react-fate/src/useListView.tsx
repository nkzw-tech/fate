import { isDeferred, type Deferred, type DeferredSnapshot } from '@nkzw/fate';
import { createConnectionReader, getListEntries, getListWindowKey } from '@nkzw/fate/list';
import { use, useCallback, useDeferredValue, useMemo, useSyncExternalStore } from 'react';
import { useFateClient } from './context.tsx';
import {
  useListViewInfo,
  type ConnectionItems,
  type ConnectionSelection,
  type ConnectionValue,
  type ResolvedConnection,
  type LoadMoreFn,
} from './listView.ts';

/**
 * Subscribes to a connection field, returning the current items and pagination
 * helpers to load the next or previous page. Nullish connections return undefined items.
 */
export function useListView<
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

  const identity = metadata
    ? `${metadata.key}|${metadata.windowKey ?? getListWindowKey(metadata.args)}`
    : '';
  const reader = useMemo(
    () => (metadata ? createConnectionReader(client, metadata) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, identity],
  );
  const subscribe = useCallback(
    (listener: () => void) => reader?.subscribe(listener) ?? (() => {}),
    [reader],
  );
  const getSnapshot = useCallback(() => reader?.getSnapshot(), [reader]);

  const listState = useDeferredValue(useSyncExternalStore(subscribe, getSnapshot, getSnapshot));
  const pagination = listState?.pagination ?? resolvedConnection?.pagination;
  const hasNext = Boolean(pagination?.hasNext);
  const hasPrevious = Boolean(pagination?.hasPrevious);
  const nextCursor = pagination?.nextCursor;
  const previousCursor = pagination?.previousCursor;

  const items = useMemo(() => {
    if (metadata && listState) {
      return getListEntries(listState).map(({ cursor, id }) => ({
        cursor,
        node: client.rootListRef(id, nodeView),
      }));
    }

    return resolvedConnection?.items;
  }, [client, resolvedConnection?.items, listState, metadata, nodeView]);

  const loadNext = useMemo(
    () => (reader && hasNext && nextCursor ? () => reader.load(nodeView, 'forward') : null),
    [reader, hasNext, nextCursor, nodeView],
  );
  const loadPrevious = useMemo(
    () =>
      reader && hasPrevious && previousCursor ? () => reader.load(nodeView, 'backward') : null,
    [reader, hasPrevious, previousCursor, nodeView],
  );

  return [items as ConnectionItems<ResolvedConnection<C>>, loadNext, loadPrevious];
}
