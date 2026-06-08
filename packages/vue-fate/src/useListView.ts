import { type Deferred, type DeferredSnapshot, type Pagination, isDeferred } from '@nkzw/fate';
import { getListEntries } from '@nkzw/fate/list';
import {
  markRaw,
  onScopeDispose,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type ShallowRef,
} from 'vue';
import { getFateClientSource, useFateClient } from './context.ts';
import {
  getConnectionMetadata,
  getNodeView,
  type ConnectionItems,
  type ConnectionSelection,
  type LoadMoreFn,
} from './listView.ts';

type ConnectionValue = { items?: ReadonlyArray<any>; pagination?: Pagination };
type ResolvedConnection<C> = C extends Deferred<infer Value> ? Value : NonNullable<C>;

export type ListViewState<C> = [
  ShallowRef<ConnectionItems<ResolvedConnection<C>>>,
  ShallowRef<LoadMoreFn | null>,
  ShallowRef<LoadMoreFn | null>,
] & {
  dispose: () => void;
  error: ShallowRef<unknown>;
  pending: ShallowRef<boolean>;
  ready: () => Promise<ConnectionItems<ResolvedConnection<C>>>;
  refresh: () => Promise<ConnectionItems<ResolvedConnection<C>>>;
};

/**
 * Subscribes to a connection field, returning the current items and pagination helpers.
 */
export function useListView<
  C extends ConnectionValue | Deferred<ConnectionValue> | null | undefined,
>(selection: ConnectionSelection, connection: MaybeRefOrGetter<C>): ListViewState<C> {
  const clientSource = getFateClientSource(useFateClient());
  const items = shallowRef<ConnectionItems<ResolvedConnection<C>>>([] as never);
  const loadNext = shallowRef<LoadMoreFn | null>(null);
  const loadPrevious = shallowRef<LoadMoreFn | null>(null);
  const errorState = shallowRef<unknown>(null);
  const pending = shallowRef(false);
  const nodeView = getNodeView(selection);
  let activeClient = clientSource.value;
  let currentConnection: ConnectionValue | null | undefined;
  let disposed = false;
  let listUnsubscribe: (() => void) | null = null;
  let token = 0;
  let currentPromise: Promise<ConnectionItems<ResolvedConnection<C>>> | null = null;

  const cleanupListSubscription = () => {
    if (listUnsubscribe) {
      listUnsubscribe();
      listUnsubscribe = null;
    }
  };

  const setLoadMore = () => {
    const metadata = getConnectionMetadata(currentConnection);
    const listState = metadata ? activeClient.store.getListState(metadata.key) : undefined;
    const pagination = listState?.pagination ?? currentConnection?.pagination;
    const hasNext = Boolean(pagination?.hasNext);
    const hasPrevious = Boolean(pagination?.hasPrevious);
    const nextCursor = pagination?.nextCursor;
    const previousCursor = pagination?.previousCursor;

    loadNext.value =
      metadata && hasNext && nextCursor
        ? async () => {
            const { before: _before, first, last, ...values } = metadata.args || {};
            const nextPageSize = first ?? last;

            await activeClient.loadConnection(
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
          }
        : null;

    loadPrevious.value =
      metadata && hasPrevious && previousCursor
        ? async () => {
            const { after: _after, first, last, ...values } = metadata.args || {};
            const previousPageSize = last ?? first;

            await activeClient.loadConnection(
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
          }
        : null;
  };

  const updateItemsFromStore = () => {
    const metadata = getConnectionMetadata(currentConnection);
    const listState = metadata ? activeClient.store.getListState(metadata.key) : undefined;

    if (metadata && listState) {
      items.value = markRaw(
        getListEntries(listState).map(({ cursor, id }) => ({
          cursor,
          node: activeClient.rootListRef(id, nodeView),
        })),
      ) as unknown as ConnectionItems<ResolvedConnection<C>>;
    } else {
      items.value = markRaw(
        (currentConnection?.items ?? []) as ConnectionItems<ResolvedConnection<C>>,
      );
    }

    setLoadMore();
  };

  const updateListSubscription = () => {
    cleanupListSubscription();
    const metadata = getConnectionMetadata(currentConnection);
    if (metadata) {
      listUnsubscribe = activeClient.store.subscribeList(metadata.key, updateItemsFromStore);
    }
  };

  const resolveConnection = async (): Promise<ConnectionValue | null | undefined> => {
    const value = toValue(connection);
    if (!isDeferred(value)) {
      return value as ConnectionValue | null | undefined;
    }

    const snapshot = await activeClient.readDeferred(value as Deferred<ConnectionValue>);
    return (snapshot as DeferredSnapshot<ConnectionValue>).data;
  };

  const refresh = () => {
    const currentToken = ++token;
    const nextClient = clientSource.value;
    if (nextClient !== activeClient) {
      cleanupListSubscription();
      activeClient = nextClient;
    }
    pending.value = true;
    errorState.value = null;

    currentPromise = Promise.resolve(resolveConnection()).then(
      (resolvedConnection) => {
        if (!disposed && currentToken === token) {
          currentConnection = resolvedConnection;
          pending.value = false;
          updateListSubscription();
          updateItemsFromStore();
        }
        return items.value;
      },
      (error) => {
        if (!disposed && currentToken === token) {
          currentConnection = null;
          errorState.value = error;
          pending.value = false;
          cleanupListSubscription();
        }
        throw error;
      },
    );
    void currentPromise.catch(() => {});

    return currentPromise;
  };

  const stop = watch(
    () => [clientSource.value, toValue(connection)] as const,
    () => {
      void refresh();
    },
    {
      immediate: true,
    },
  );

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    stop();
    cleanupListSubscription();
  };

  onScopeDispose(dispose);

  return Object.assign([items, loadNext, loadPrevious], {
    dispose,
    error: errorState,
    pending,
    ready: () => currentPromise ?? refresh(),
    refresh,
  }) as ListViewState<C>;
}
