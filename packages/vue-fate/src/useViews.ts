import {
  type Deferred,
  type EntityId,
  type FateClient,
  type View,
  type ViewData,
  type ViewEntity,
  type ViewEntityName,
  type ViewRef,
  type ViewSelection,
  isDeferred,
  resolveView,
} from '@nkzw/fate';
import { markRaw, onScopeDispose, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue';
import { getFateClientSource, useFateClient } from './context.ts';
import { fulfilledThenable, isFulfilledThenable } from './thenable.ts';
import type { ViewResource } from './useView.ts';

type ViewInput<V extends View<any, any>> =
  | Deferred<ViewRef<ViewEntityName<V>> | null | undefined>
  | ViewRef<ViewEntityName<V>>
  | null
  | undefined;
type ViewResult<V extends View<any, any>, R> =
  R extends Deferred<infer Resolved>
    ? ViewResult<V, Resolved>
    : R extends null | undefined
      ? R
      : ViewData<ViewEntity<V> & { __typename: ViewEntityName<V> }, ViewSelection<V>>;
type Results<V extends View<any, any>, R extends ReadonlyArray<ViewInput<V>>> = {
  readonly [K in keyof R]: ViewResult<V, R[K]>;
};
type Snapshot = {
  coverage: ReadonlyArray<readonly [EntityId, ReadonlySet<string>]>;
  data: unknown;
};

const sameItems = (first: ReadonlyArray<unknown>, second: ReadonlyArray<unknown>) =>
  first.length === second.length && first.every((value, index) => value === second[index]);
const samePaths = (first: ReadonlySet<string>, second: ReadonlySet<string>) =>
  first.size === second.size && [...first].every((path) => second.has(path));

const readSnapshot = <V extends View<any, any>>(
  client: FateClient<any, any>,
  view: V,
  ref: ViewInput<V>,
  onCoverage: (coverage: Snapshot['coverage']) => void,
): PromiseLike<Snapshot> => {
  if (ref == null) {
    return fulfilledThenable({ coverage: [], data: ref });
  }
  if (!isDeferred(ref)) {
    return client.readView(view, ref);
  }
  const deferred = client.readDeferred(ref);
  const readResolved = (value: Awaited<typeof deferred>): PromiseLike<Snapshot> => {
    const resolved = value.data;
    onCoverage(value.coverage);
    if (resolved == null) {
      return fulfilledThenable({ coverage: value.coverage, data: resolved });
    }
    const snapshot = client.readView(
      view,
      client.ref(resolved.__typename, resolved.id, resolveView(view, resolved)),
    );
    const merge = (snapshot: Snapshot): Snapshot => ({
      coverage: [...value.coverage, ...snapshot.coverage],
      data: snapshot.data,
    });
    return isFulfilledThenable(snapshot)
      ? fulfilledThenable(merge(snapshot.value))
      : Promise.resolve(snapshot).then(merge);
  };
  return isFulfilledThenable(deferred)
    ? readResolved(deferred.value)
    : Promise.resolve(deferred).then(readResolved);
};

/**
 * Resolves an array of references and subscribes to their selected fields.
 * Accepts a plain array, reactive ref, or getter. Results preserve order,
 * duplicates, nullish entries, parameter bindings, and readonly tuple types.
 * Await `ready()` to participate in Vue Suspense.
 *
 * @example
 * const users = useViews(UserView, () => props.users);
 * await users.ready();
 */
export function useViews<V extends View<any, any>, const R extends ReadonlyArray<ViewInput<V>>>(
  view: V,
  refs: MaybeRefOrGetter<R>,
): ViewResource<Results<V, R>> {
  const clientSource = getFateClientSource(useFateClient());
  const data = shallowRef<ReadonlyArray<unknown>>(markRaw([]));
  const errorState = shallowRef<unknown>(null);
  const pending = shallowRef(false);
  const subscriptions = new Map<
    EntityId,
    { paths: ReadonlySet<string>; unsubscribe: () => void }
  >();
  let activeClient = clientSource.value;
  let activeRefs: ReadonlyArray<ViewInput<V>> | undefined;
  let currentPromise: Promise<ReadonlyArray<unknown>> | undefined;
  let token = 0;
  let revision = 0;
  let readRevision = 0;
  let disposed = false;
  let scheduled = false;

  const cleanup = () => {
    for (const { unsubscribe } of subscriptions.values()) {
      unsubscribe();
    }
    subscriptions.clear();
  };
  const onChange = () => {
    revision++;
    if (!scheduled && !disposed) {
      // Normalize a burst of entity writes before reading the whole array again.
      scheduled = true;
      queueMicrotask(() => {
        if (scheduled && !disposed) {
          void refresh();
        }
      });
    }
  };
  const updateSubscriptions = (coverages: ReadonlyArray<Snapshot['coverage']>) => {
    const coverage = new Map<EntityId, Set<string>>();
    for (const selection of coverages) {
      for (const [id, paths] of selection) {
        const selected = coverage.get(id);
        if (selected) {
          for (const path of paths) {
            selected.add(path);
          }
        } else {
          coverage.set(id, new Set(paths));
        }
      }
    }
    for (const [id, { unsubscribe }] of subscriptions) {
      if (!coverage.has(id)) {
        unsubscribe();
        subscriptions.delete(id);
      }
    }
    for (const [id, paths] of coverage) {
      const previous = subscriptions.get(id);
      if (!previous || !samePaths(paths, previous.paths)) {
        previous?.unsubscribe();
        subscriptions.set(id, {
          paths,
          unsubscribe: activeClient.store.subscribe(id, paths, onChange),
        });
      }
    }
  };
  const inputsChanged = () =>
    activeClient !== clientSource.value || !activeRefs || !sameItems(activeRefs, toValue(refs));

  function refresh(recheck = false): Promise<ReadonlyArray<unknown>> {
    if (disposed) {
      return Promise.resolve(data.value);
    }
    scheduled = false;
    if (!recheck && pending.value && !inputsChanged() && readRevision === revision) {
      return currentPromise!;
    }
    const currentToken = ++token;
    if (activeClient !== clientSource.value) {
      cleanup();
      activeClient = clientSource.value;
    }
    activeRefs = [...toValue(refs)];
    readRevision = revision;
    const client = activeClient;
    const snapshots = new Map<ViewInput<V>, PromiseLike<Snapshot>>();
    const coverage = new Map<ViewInput<V>, Snapshot['coverage']>();
    let reading = true;
    const reads = activeRefs.map((ref) => {
      let snapshot = snapshots.get(ref);
      if (!snapshot) {
        try {
          const onCoverage = (paths: Snapshot['coverage']) => {
            if (reading) {
              coverage.set(ref, paths);
            }
          };
          snapshot = readSnapshot(client, view, ref, onCoverage);
          if (isFulfilledThenable(snapshot)) {
            onCoverage(snapshot.value.coverage);
          }
        } catch (error) {
          snapshot = Promise.reject(error);
        }
        snapshots.set(ref, snapshot);
      }
      return snapshot;
    });
    reading = false;
    // Keep available fields and deferred owners observed while other entries load.
    // Replacing this coverage also releases refs removed from a pending array.
    updateSubscriptions([...coverage.values()]);
    errorState.value = null;
    const commit = (values: ReadonlyArray<Snapshot>) => {
      const result = values.map(({ data }) => data);
      if (!disposed && currentToken === token) {
        if (!sameItems(data.value, result)) {
          data.value = markRaw(result);
        }
        pending.value = false;
        updateSubscriptions(values.map(({ coverage }) => coverage));
        return data.value;
      }
      return result;
    };
    if (reads.every(isFulfilledThenable)) {
      commit(reads.map(({ value }) => value));
      currentPromise = Promise.resolve(data.value);
    } else {
      currentPromise = Promise.all(reads).then(
        (values) => {
          // Entries that finished first may have changed while other reads loaded.
          // Recheck the complete selection once, rather than rereading it for each
          // individual completion or committing stale cached data.
          return !disposed && currentToken === token
            ? refresh(true)
            : values.map(({ data }) => data);
        },
        (error) => {
          if (!disposed && currentToken === token) {
            token++;
            errorState.value = error;
            pending.value = false;
            cleanup();
          }
          throw error;
        },
      );
      void currentPromise.catch(() => {});
      pending.value = true;
    }
    return currentPromise;
  }

  const stop = watch(
    () => [clientSource.value, ...toValue(refs)],
    () => {
      if (inputsChanged()) {
        void refresh();
      }
    },
    { immediate: true },
  );
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    token++;
    scheduled = false;
    stop();
    cleanup();
  };
  onScopeDispose(dispose);
  return Object.assign(data, {
    dispose,
    error: errorState,
    pending,
    ready: () => (scheduled || inputsChanged() ? refresh() : (currentPromise ?? refresh())),
    refresh,
  }) as ViewResource<Results<V, R>>;
}
