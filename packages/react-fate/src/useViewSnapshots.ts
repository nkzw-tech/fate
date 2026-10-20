import {
  type Deferred,
  type EntityId,
  type FateClient,
  isDeferred,
  resolveView,
  type View,
  type ViewEntityName,
  type ViewRef,
} from '@nkzw/fate';
import { use, useDeferredValue, useMemo, useState, useSyncExternalStore } from 'react';
import { useFateClient } from './context.tsx';
import { fulfilledThenable, isFulfilledThenable } from './thenable.ts';

export type ViewInput<V extends View<any, any>> =
  | Deferred<ViewRef<ViewEntityName<V>> | null | undefined>
  | ViewRef<ViewEntityName<V>>
  | null
  | undefined;

type Snapshot = Readonly<{
  coverage: ReadonlyArray<readonly [EntityId, ReadonlySet<string>]>;
  data: unknown;
}>;
type ReadSnapshot = () => PromiseLike<Snapshot>;

// A mounted reader keeps its error stable for React to deliver to a boundary.
// Core in-flight requests are released on failure so a fresh reader can retry.
const cacheReadError = (read: ReadSnapshot): ReadSnapshot => {
  let current: PromiseLike<Snapshot> | undefined;
  let failed = false;
  return () => {
    if (failed) {
      return current!;
    }
    const snapshot = read();
    if (current !== snapshot) {
      current = snapshot;
      if (!isFulfilledThenable(snapshot)) {
        Promise.resolve(snapshot).catch(() => {
          if (current === snapshot) {
            failed = true;
          }
        });
      }
    }
    return snapshot;
  };
};

const createReader = <V extends View<any, any>>(
  client: FateClient<any, any>,
  view: V,
  ref: ViewInput<V>,
): ReadSnapshot => {
  if (ref == null) {
    const snapshot = fulfilledThenable({ coverage: [], data: ref });
    return () => snapshot;
  }
  if (!isDeferred(ref)) {
    return () => client.readView(view, ref);
  }

  let pendingDeferred: PromiseLike<unknown> | undefined;
  let pendingSnapshot: PromiseLike<Snapshot>;
  let mergedSource: unknown;
  let mergedCoverage: Snapshot['coverage'] | undefined;
  let mergedSnapshot: PromiseLike<Snapshot>;
  const empty = fulfilledThenable({ coverage: [], data: null });
  const absent = fulfilledThenable({ coverage: [], data: undefined });
  return () => {
    const deferred = client.readDeferred(ref);
    const readResolved = (value: Awaited<typeof deferred>): PromiseLike<Snapshot> => {
      const resolved = value.data;
      const source: PromiseLike<Snapshot> =
        resolved == null
          ? resolved === null
            ? empty
            : absent
          : client.readView(
              view,
              client.ref(resolved.__typename, resolved.id, resolveView(view, resolved)),
            );
      const sourceKey = isFulfilledThenable(source) ? source.value : source;
      if (sourceKey === mergedSource && sameCoverage(value.coverage, mergedCoverage)) {
        return mergedSnapshot;
      }
      mergedSource = sourceKey;
      mergedCoverage = value.coverage;
      const merge = (snapshot: Snapshot): Snapshot => ({
        coverage: combineCoverage([value, snapshot]),
        data: snapshot.data,
      });
      mergedSnapshot = isFulfilledThenable(source)
        ? fulfilledThenable(merge(source.value))
        : Promise.resolve(source).then(merge);
      return mergedSnapshot;
    };

    if (isFulfilledThenable(deferred)) {
      pendingDeferred = undefined;
      return readResolved(deferred.value);
    }
    if (pendingDeferred !== deferred) {
      pendingDeferred = deferred;
      pendingSnapshot = Promise.resolve(deferred).then(readResolved);
    }
    return pendingSnapshot;
  };
};

const samePaths = (paths: ReadonlySet<string>, previous: ReadonlySet<string>) =>
  paths.size === previous.size && [...paths].every((path) => previous.has(path));

const sameCoverage = (coverage: Snapshot['coverage'], previous: Snapshot['coverage'] | undefined) =>
  previous?.length === coverage.length &&
  coverage.every(
    ([id, paths], index) => id === previous[index][0] && samePaths(paths, previous[index][1]),
  );

const combineCoverage = (snapshots: ReadonlyArray<Snapshot>): Snapshot['coverage'] => {
  const coverage = new Map<EntityId, Set<string>>();
  for (const snapshot of snapshots) {
    for (const [id, paths] of snapshot.coverage) {
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
  return [...coverage];
};

const createArrayReader = <V extends View<any, any>>(
  client: FateClient<any, any>,
  view: V,
  refs: ReadonlyArray<ViewInput<V>>,
): ReadSnapshot => {
  // A duplicate ref must share its reader, including pending deferred reads.
  const indexes = new Map<ViewInput<V>, number>();
  const readers: Array<ReadSnapshot> = [];
  const order = refs.map((ref) => {
    let index = indexes.get(ref);
    if (index === undefined) {
      index = readers.length;
      indexes.set(ref, index);
      readers.push(cacheReadError(createReader(client, view, ref)));
    }
    return index;
  });
  let previous: ReadonlyArray<PromiseLike<Snapshot>> | undefined;
  let result: PromiseLike<Snapshot>;
  return () => {
    // Read every entry before suspending so missing selections fetch together.
    const current: Array<PromiseLike<Snapshot>> = [];
    let failed = false;
    let firstError: unknown;
    for (const read of readers) {
      try {
        current.push(read());
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
    if (failed) {
      // A synchronous error must not leave other entries' requests unhandled.
      for (const snapshot of current) {
        Promise.resolve(snapshot).catch(() => {});
      }
      throw firstError;
    }
    const cached = previous;
    if (cached && current.every((snapshot, index) => snapshot === cached[index])) {
      return result;
    }
    previous = current;
    const collect = (values: ReadonlyArray<Snapshot>) => {
      return {
        coverage: combineCoverage(values),
        data: order.map((index) => values[index].data),
      };
    };
    result = current.every(isFulfilledThenable)
      ? fulfilledThenable(collect(current.map(({ value }) => value)))
      : Promise.all(current).then(collect);
    return result;
  };
};

const createSubscribe =
  (client: FateClient<any, any>, getSnapshot: ReadSnapshot, batch: boolean) =>
  (onStoreChange: () => void) => {
    const subscriptions = new Map<
      EntityId,
      { paths: ReadonlySet<string>; unsubscribe: () => void }
    >();
    let disposed = false;
    let pending: PromiseLike<Snapshot> | undefined;
    let scheduled = false;
    const notify = () => {
      if (disposed) {
        return;
      }
      try {
        updateSubscriptions();
      } catch {
        // React reads snapshot errors so error boundaries can handle them.
      }
      onStoreChange();
    };
    const onChange = () => {
      if (!batch) {
        notify();
      } else if (!scheduled) {
        // A response can update many selected entities in the same turn. Read
        // the array once after those writes, rather than once per entity.
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          notify();
        });
      }
    };
    const updateSubscriptions = () => {
      const snapshot = getSnapshot();
      if (!isFulfilledThenable(snapshot)) {
        if (pending !== snapshot) {
          pending = snapshot;
          Promise.resolve(snapshot).then(
            () => {
              if (!disposed && pending === snapshot) {
                onChange();
              }
            },
            () => {
              if (!disposed && pending === snapshot) {
                onStoreChange();
              }
            },
          );
        }
        return;
      }
      pending = undefined;
      const nextIds = new Set<EntityId>();
      for (const [id, paths] of snapshot.value.coverage) {
        nextIds.add(id);
        const previous = subscriptions.get(id);
        if (!previous || !samePaths(paths, previous.paths)) {
          previous?.unsubscribe();
          subscriptions.set(id, {
            paths,
            unsubscribe: client.store.subscribe(id, paths, onChange),
          });
        }
      }
      for (const [id, { unsubscribe }] of subscriptions) {
        if (!nextIds.has(id)) {
          unsubscribe();
          subscriptions.delete(id);
        }
      }
    };
    updateSubscriptions();
    return () => {
      disposed = true;
      for (const { unsubscribe } of subscriptions.values()) {
        unsubscribe();
      }
      subscriptions.clear();
    };
  };

export function useViewSnapshots<V extends View<any, any>>(
  view: V,
  refs: ReadonlyArray<ViewInput<V>>,
): ReadonlyArray<unknown> {
  const client = useFateClient();
  const [previousRefs, setPreviousRefs] = useState(refs);
  // Callers can construct arrays inline without rebuilding readers and subscriptions.
  const unchanged =
    refs.length === previousRefs.length && refs.every((ref, index) => ref === previousRefs[index]);
  const stableRefs = unchanged ? previousRefs : refs;
  if (!unchanged) {
    setPreviousRefs(refs);
  }
  const getSnapshot = useMemo(
    () => createArrayReader(client, view, stableRefs),
    [client, view, stableRefs],
  );
  return useSnapshot(client, getSnapshot, true) as ReadonlyArray<unknown>;
}

export function useViewSnapshot<V extends View<any, any>>(view: V, ref: ViewInput<V>): unknown {
  const client = useFateClient();
  const getSnapshot = useMemo(
    () => cacheReadError(createReader(client, view, ref)),
    [client, view, ref],
  );
  return useSnapshot(client, getSnapshot, false);
}

function useSnapshot(
  client: FateClient<any, any>,
  getSnapshot: ReadSnapshot,
  batch: boolean,
): unknown {
  const subscribe = useMemo(
    () => createSubscribe(client, getSnapshot, batch),
    [client, getSnapshot, batch],
  );
  const snapshot = use(useDeferredValue(useSyncExternalStore(subscribe, getSnapshot, getSnapshot)));
  return snapshot.data;
}
