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
import { isFulfilledThenable } from './thenable.ts';

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
  return useListViewResource(selection, connection).resource;
}

/** @internal Shares the resolved connection with the live list wrapper. */
export function useListViewResource<
  C extends ConnectionValue | Deferred<ConnectionValue | null | undefined> | null | undefined,
>(selection: ConnectionSelection, connection: MaybeRefOrGetter<C>) {
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
  const resolvedConnection = shallowRef<ConnectionValue | null | undefined>();
  let disposed = false;
  let listUnsubscribe: (() => void) | null = null;
  let deferredSubscriptions: Array<() => void> = [];
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
    const pagination = reader?.getSnapshot()?.pagination ?? resolvedConnection.value?.pagination;
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
    const metadata = getConnectionMetadata(resolvedConnection.value);
    const listState = reader?.getSnapshot();

    if (metadata && listState) {
      items.value = markRaw(
        getListEntries(listState).map(({ cursor, id }) => ({
          cursor,
          node: activeClient.rootListRef(id, nodeView),
        })),
      ) as unknown as ConnectionItems<ResolvedConnection<C>>;
    } else {
      const currentItems = resolvedConnection.value?.items;
      items.value = (currentItems ? markRaw(currentItems) : undefined) as ConnectionItems<
        ResolvedConnection<C>
      >;
    }

    setLoadMore();
  };

  const updateListSubscription = () => {
    cleanupListSubscription();
    const metadata = getConnectionMetadata(resolvedConnection.value);
    const identity = metadata
      ? `${metadata.key}|${metadata.windowKey ?? getListWindowKey(metadata.args)}`
      : '';
    if (identity !== readerIdentity || !reader) {
      reader = metadata ? createConnectionReader(activeClient, metadata) : null;
      readerIdentity = identity;
    }
    listUnsubscribe = reader?.subscribe(updateItemsFromStore) ?? null;
  };

  const cleanupDeferredSubscriptions = () => {
    deferredSubscriptions.forEach((unsubscribe) => unsubscribe());
    deferredSubscriptions = [];
  };

  const refresh = () => {
    const currentToken = ++token;
    const nextClient = clientSource.value;
    if (nextClient !== activeClient) {
      cleanupListSubscription();
      cleanupDeferredSubscriptions();
      activeClient = nextClient;
      resolvedConnection.value = undefined;
      reader = null;
      readerIdentity = '';
    }
    pending.value = true;
    errorState.value = null;

    const publish = (
      value: ConnectionValue | null | undefined,
      coverage: DeferredSnapshot<unknown>['coverage'] = [],
    ) => {
      if (!disposed && currentToken === token) {
        cleanupDeferredSubscriptions();
        deferredSubscriptions = coverage.map(([id, paths]) =>
          nextClient.store.subscribe(id, paths, () => {
            queueMicrotask(() => {
              if (!disposed && token === currentToken) {
                void refresh();
              }
            });
          }),
        );
        resolvedConnection.value = value;
        pending.value = false;
        updateListSubscription();
        updateItemsFromStore();
      }
      return items.value;
    };
    const fail = (error: unknown) => {
      if (!disposed && currentToken === token) {
        resolvedConnection.value = null;
        errorState.value = error;
        pending.value = false;
        cleanupListSubscription();
      }
      throw error;
    };

    const resolve = async () => {
      const value = toValue(connection);
      if (!isDeferred(value)) {
        return publish(value as ConnectionValue | null | undefined);
      }
      const read = nextClient.readDeferred(value as Deferred<ConnectionValue | null | undefined>);
      const snapshot = isFulfilledThenable(read) ? read.value : await read;
      return publish(snapshot.data, snapshot.coverage);
    };
    currentPromise = resolve().catch(fail);
    void currentPromise.catch(() => {});

    return currentPromise;
  };

  const stop = watch(
    () => [clientSource.value, toValue(connection)] as const,
    () => {
      cleanupDeferredSubscriptions();
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
    cleanupDeferredSubscriptions();
    cleanupListSubscription();
  };

  onScopeDispose(dispose);

  const resource = Object.assign([items, loadNext, loadPrevious], {
    dispose,
    error: errorState,
    pending,
    ready: () => currentPromise ?? refresh(),
    refresh,
  }) as ListViewState<C>;
  return { resolvedConnection, resource };
}
