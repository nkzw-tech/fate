import {
  ConnectionMetadata,
  ConnectionTag,
  isViewTag,
  Pagination,
  type View,
} from '@nkzw/fate';
import {
  useCallback,
  useDeferredValue,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { useFateClient } from './context.tsx';

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

export function useListView<
  C extends
    | { items?: ReadonlyArray<any>; pagination?: Pagination }
    | null
    | undefined,
>(
  selection: ConnectionSelection,
  connection: C,
): [ConnectionItems<NonNullable<C>>, LoadMoreFn | null, LoadMoreFn | null] {
  const client = useFateClient();
  const nodeView = useMemo(() => getNodeView(selection), [selection]);
  const metadata =
    connection && typeof connection === 'object'
      ? ((connection as Record<symbol, unknown>)[ConnectionTag] as
          | ConnectionMetadata
          | undefined)
      : null;

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!metadata) {
        return () => {};
      }

      return client.store.subscribeList(metadata.key, onStoreChange);
    },
    [client, metadata],
  );

  const getSnapshot = useCallback(() => {
    if (!metadata) {
      return undefined;
    }

    return client.store.getListState(metadata.key);
  }, [client, metadata]);

  const listState = useDeferredValue(
    useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
  );
  const pagination = connection?.pagination ?? listState?.pagination;
  const hasNext = Boolean(pagination?.hasNext);
  const hasPrevious = Boolean(pagination?.hasPrevious);
  const nextCursor = pagination?.nextCursor;
  const previousCursor = pagination?.previousCursor;

  const loadNext = useMemo(() => {
    if (!metadata || !hasNext || !nextCursor) {
      return null;
    }

    return async () => {
      const { before, last, ...values } = metadata.args || {};
      await client.loadConnection(
        nodeView,
        metadata,
        {
          ...values,
          after: nextCursor,
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
      const { after, ...values } = metadata.args || {};
      await client.loadConnection(
        nodeView,
        metadata,
        {
          ...values,
          before: previousCursor,
        },
        {
          direction: 'backward',
        },
      );
    };
  }, [client, hasPrevious, nodeView, metadata, previousCursor]);

  return [
    connection?.items as unknown as ConnectionItems<NonNullable<C>>,
    loadNext,
    loadPrevious,
  ];
}
