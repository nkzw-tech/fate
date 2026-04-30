import { ConnectionMetadata, ConnectionTag, isViewTag, Pagination, type View } from '@nkzw/fate';
import { useCallback, useDeferredValue, useMemo, useSyncExternalStore } from 'react';
import { useFateClient } from './context.tsx';

type ListEntry = Readonly<{ cursor?: string; id: string }>;

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

  return view;
};

const getListEntries = (
  listState:
    | Readonly<{
        cursors?: ReadonlyArray<string | undefined>;
        ids: ReadonlyArray<string>;
        pendingAfterIds?: ReadonlyArray<string>;
        pendingBeforeIds?: ReadonlyArray<string>;
      }>
    | undefined,
): Array<ListEntry> => {
  if (!listState) {
    return [];
  }

  const entries: Array<ListEntry> = [];

  for (const id of listState.pendingBeforeIds ?? []) {
    entries.push({ id });
  }

  listState.ids.forEach((id, index) => {
    entries.push({ cursor: listState.cursors?.[index], id });
  });

  for (const id of listState.pendingAfterIds ?? []) {
    entries.push({ id });
  }

  return entries;
};

/**
 * Subscribes to a connection field, returning the current items and pagination
 * helpers to load the next or previous page.
 */
export function useListView<
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

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      metadata ? client.store.subscribeList(metadata.key, onStoreChange) : () => {},
    [client, metadata],
  );

  const getSnapshot = useCallback(
    () => (metadata ? client.store.getListState(metadata.key) : undefined),
    [client, metadata],
  );

  const listState = useDeferredValue(useSyncExternalStore(subscribe, getSnapshot, getSnapshot));
  const pagination = listState?.pagination ?? connection?.pagination;
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

    return connection?.items;
  }, [client, connection?.items, listState, metadata, nodeView]);

  const loadNext = useMemo(() => {
    if (!metadata || !hasNext || !nextCursor) {
      return null;
    }

    return async () => {
      const { before, first, last, ...values } = metadata.args || {};
      const nextPageSize = first ?? last;

      await client.loadConnection(
        nodeView,
        metadata,
        {
          ...values,
          after: nextCursor,
          before: undefined,
          ...(nextPageSize !== undefined ? { first: nextPageSize } : null),
          last: undefined,
        },
        {
          direction: 'forward',
        },
      );
    };
  }, [client, hasNext, nodeView, metadata, nextCursor]);

  const loadPrevious = useMemo(() => {
    if (!metadata || !hasPrevious || !previousCursor) {
      return null;
    }

    return async () => {
      const { after, first, last, ...values } = metadata.args || {};
      const previousPageSize = last ?? first;
      await client.loadConnection(
        nodeView,
        metadata,
        {
          ...values,
          after: undefined,
          before: previousCursor,
          first: undefined,
          ...(previousPageSize !== undefined ? { last: previousPageSize } : null),
        },
        {
          direction: 'backward',
        },
      );
    };
  }, [client, hasPrevious, nodeView, metadata, previousCursor]);

  return [items as ConnectionItems<NonNullable<C>>, loadNext, loadPrevious];
}
