import { type Deferred, type DeferredSnapshot, type Pagination, isDeferred } from '@nkzw/fate';
import { onScopeDispose, toValue, watch, type MaybeRefOrGetter } from 'vue';
import { getFateClientSource, useFateClient } from './context.ts';
import {
  getConnectionMetadata,
  getNodeView,
  type ConnectionItems,
  type ConnectionSelection,
  type LoadMoreFn,
} from './listView.ts';
import { useListView, type ListViewState } from './useListView.ts';

type ConnectionValue = { items?: ReadonlyArray<any>; pagination?: Pagination };
type ResolvedConnection<C> = C extends Deferred<infer Value> ? Value : NonNullable<C>;

/**
 * Subscribes to a connection field, returning live-updating items and pagination helpers.
 */
export function useLiveListView<
  C extends ConnectionValue | Deferred<ConnectionValue> | null | undefined,
>(selection: ConnectionSelection, connection: MaybeRefOrGetter<C>): ListViewState<C> {
  const clientSource = getFateClientSource(useFateClient());
  const listResource = useListView(selection, connection);
  const nodeView = getNodeView(selection);
  let liveUnsubscribe: (() => void) | undefined;
  let disposed = false;
  let token = 0;

  const cleanupLiveSubscription = () => {
    liveUnsubscribe?.();
    liveUnsubscribe = undefined;
  };

  const resolveConnection = async (): Promise<ConnectionValue | null | undefined> => {
    const value = toValue(connection);
    if (!isDeferred(value)) {
      return value as ConnectionValue | null | undefined;
    }

    return (
      (await clientSource.value.readDeferred(
        value as Deferred<ConnectionValue>,
      )) as DeferredSnapshot<ConnectionValue>
    ).data;
  };

  const subscribe = () => {
    const currentToken = ++token;
    cleanupLiveSubscription();

    void resolveConnection()
      .then((resolvedConnection) => {
        if (disposed || currentToken !== token) {
          return;
        }

        const metadata = getConnectionMetadata(resolvedConnection);
        if (!metadata) {
          return;
        }

        const client = clientSource.value;
        client.assertLiveConnectionSupport();
        liveUnsubscribe = client.subscribeLiveListView(nodeView, metadata);
      })
      .catch((error: unknown) => {
        if (!disposed && currentToken === token) {
          listResource.error.value = error;
          listResource.pending.value = false;
        }
      });
  };

  const stop = watch(() => [clientSource.value, toValue(connection)] as const, subscribe, {
    immediate: true,
  });

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    token++;
    stop();
    cleanupLiveSubscription();
    listResource.dispose();
  };

  onScopeDispose(dispose);

  return Object.assign(listResource, { dispose }) as [
    ConnectionItems<ResolvedConnection<C>>,
    LoadMoreFn | null,
    LoadMoreFn | null,
  ] &
    ListViewState<C>;
}
