import { type Deferred } from '@nkzw/fate';
import { computed, onScopeDispose, watch, type MaybeRefOrGetter } from 'vue';
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
  const metadata = computed(() => getConnectionMetadata(resolvedConnection.value));
  const disposeResource = listResource.dispose;
  const nodeView = getNodeView(selection);
  let liveUnsubscribe: (() => void) | undefined;
  let disposed = false;

  const stop = watch(
    [
      clientSource,
      () => metadata.value?.key,
      () => metadata.value?.windowKey,
      () => metadata.value?.live?.append,
      () => metadata.value?.live?.prepend,
    ],
    ([client]) => {
      liveUnsubscribe?.();
      liveUnsubscribe = undefined;
      if (metadata.value) {
        try {
          liveUnsubscribe = client.subscribeLiveListView(nodeView, metadata.value);
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
