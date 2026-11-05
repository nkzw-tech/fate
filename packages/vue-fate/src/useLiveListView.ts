import { type Deferred } from '@nkzw/fate';
import { onScopeDispose, watch, type MaybeRefOrGetter } from 'vue';
import { getFateClientSource, useFateClient } from './context.ts';
import {
  getConnectionMetadata,
  getNodeView,
  type ConnectionSelection,
  type ConnectionValue,
} from './listView.ts';
import { useListViewResource, type ListViewState } from './useListView.ts';

/**
 * Subscribes to a connection field, returning live-updating items and pagination helpers.
 */
export function useLiveListView<
  C extends ConnectionValue | Deferred<ConnectionValue | null | undefined> | null | undefined,
>(selection: ConnectionSelection, connection: MaybeRefOrGetter<C>): ListViewState<C> {
  const clientSource = getFateClientSource(useFateClient());
  const { resolvedConnection, resource: listResource } = useListViewResource(selection, connection);
  const disposeResource = listResource.dispose;
  const nodeView = getNodeView(selection);
  let liveUnsubscribe: (() => void) | undefined;
  let disposed = false;

  const stop = watch(
    [clientSource, () => getConnectionMetadata(resolvedConnection.value)?.key],
    ([client]) => {
      liveUnsubscribe?.();
      liveUnsubscribe = undefined;
      const metadata = getConnectionMetadata(resolvedConnection.value);
      if (metadata) {
        try {
          client.assertLiveConnectionSupport();
          liveUnsubscribe = client.subscribeLiveListView(nodeView, metadata);
        } catch (error) {
          listResource.error.value = error;
          listResource.pending.value = false;
        }
      }
    },
    { immediate: true },
  );

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    stop();
    liveUnsubscribe?.();
    disposeResource();
  };

  onScopeDispose(dispose);

  return Object.assign(listResource, { dispose });
}
