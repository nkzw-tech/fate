import {
  ConnectionMetadata,
  ConnectionTag,
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

type LoadMoreFn = (() => Promise<void>) | null;

export function useListView<
  V extends View<any, any>,
  C extends
    | { items?: ReadonlyArray<any>; pagination?: Pagination }
    | null
    | undefined,
>(
  view: V,
  connection: C,
): [ConnectionItems<NonNullable<C>>, LoadMoreFn, LoadMoreFn] {
  const client = useFateClient();
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

  const loadNext: LoadMoreFn = useMemo(() => {
    if (!metadata || !hasNext || !nextCursor) {
      return null;
    }

    return async () => {
      const { before, last, ...values } = metadata.args || {};
      await client.loadConnection(
        view,
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
  }, [client, hasNext, metadata, nextCursor, view]);

  const loadPrevious: LoadMoreFn = useMemo(() => {
    if (!metadata || !hasPrevious || !previousCursor) {
      return null;
    }

    return async () => {
      const { after, ...values } = metadata.args || {};
      await client.loadConnection(
        view,
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
  }, [client, hasPrevious, metadata, previousCursor, view]);

  return [
    connection?.items as unknown as ConnectionItems<NonNullable<C>>,
    loadNext,
    loadPrevious,
  ];
}
