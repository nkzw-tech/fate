import { type Deferred, type DeferredSnapshot, isDeferred } from '@nkzw/fate';
import { createConnectionReader, getListEntries, getListWindowKey } from '@nkzw/fate/list';
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
  type ConnectionValue,
  type ResolvedConnection,
  type LoadMoreFn,
} from './listView.ts';

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
  C extends ConnectionValue | Deferred<ConnectionValue | null | undefined> | null | undefined,
>(selection: ConnectionSelection, connection: MaybeRefOrGetter<C>): ListViewState<C> {
  const clientSource = getFateClientSource(useFateClient());
  const initialConnection = toValue(connection);
  const items = shallowRef<ConnectionItems<ResolvedConnection<C>>>(
    (isDeferred(initialConnection) ? [] : initialConnection?.items) as ConnectionItems<
      ResolvedConnection<C>
    >,
  );
  const loadNext = shallowRef<LoadMoreFn | null>(null);
  const loadPrevious = shallowRef<LoadMoreFn | null>(null);
  const errorState = shallowRef<unknown>(null);
  const pending = shallowRef(false);
  const nodeView = getNodeView(selection);
  let activeClient = clientSource.value;
  let currentConnection: ConnectionValue | null | undefined;
  let disposed = false;
  let listUnsubscribe: (() => void) | null = null;
  let reader: ReturnType<typeof createConnectionReader> | null = null;
  let readerIdentity = '';
  let token = 0;
  let currentPromise: Promise<ConnectionItems<ResolvedConnection<C>>> | null = null;

  const cleanupListSubscription = () => {
    if (listUnsubscribe) {
      listUnsubscribe();
      listUnsubscribe = null;
    }
  };

  const setLoadMore = () => {
    const pagination = reader?.getSnapshot()?.pagination ?? currentConnection?.pagination;
    const currentReader = reader;
    loadNext.value =
      currentReader && pagination?.hasNext && pagination.nextCursor
        ? () => currentReader.load(nodeView, 'forward')
        : null;
    loadPrevious.value =
      currentReader && pagination?.hasPrevious && pagination.previousCursor
        ? () => currentReader.load(nodeView, 'backward')
        : null;
  };

  const updateItemsFromStore = () => {
    const metadata = getConnectionMetadata(currentConnection);
    const listState = reader?.getSnapshot();

    if (metadata && listState) {
      items.value = markRaw(
        getListEntries(listState).map(({ cursor, id }) => ({
          cursor,
          node: activeClient.rootListRef(id, nodeView),
        })),
      ) as unknown as ConnectionItems<ResolvedConnection<C>>;
    } else {
      const currentItems = currentConnection?.items;
      items.value = (currentItems ? markRaw(currentItems) : undefined) as ConnectionItems<
        ResolvedConnection<C>
      >;
    }

    setLoadMore();
  };

  const updateListSubscription = () => {
    cleanupListSubscription();
    const metadata = getConnectionMetadata(currentConnection);
    const identity = metadata
      ? `${metadata.key}|${metadata.windowKey ?? getListWindowKey(metadata.args)}`
      : '';
    if (identity !== readerIdentity || !reader) {
      reader = metadata ? createConnectionReader(activeClient, metadata) : null;
      readerIdentity = identity;
    }
    listUnsubscribe = reader?.subscribe(updateItemsFromStore) ?? null;
  };

  const resolveConnection = async (): Promise<ConnectionValue | null | undefined> => {
    const value = toValue(connection);
    if (!isDeferred(value)) {
      return value as ConnectionValue | null | undefined;
    }

    const snapshot = await activeClient.readDeferred(
      value as Deferred<ConnectionValue | null | undefined>,
    );
    return (snapshot as DeferredSnapshot<ConnectionValue | null | undefined>).data;
  };

  const refresh = () => {
    const currentToken = ++token;
    const nextClient = clientSource.value;
    if (nextClient !== activeClient) {
      cleanupListSubscription();
      activeClient = nextClient;
      reader = null;
      readerIdentity = '';
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
