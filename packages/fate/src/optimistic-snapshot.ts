import { isRecord, setRecordValue } from './record.ts';
import type { AnyRecord } from './types.ts';

/** Server metadata for the values in one entity snapshot. */
export type OptimisticSnapshot = Readonly<{
  appliedMutationIds?: ReadonlyArray<string>;
  revision: number;
}>;

export const optimisticSnapshotKey = '\0fate:optimistic';
const fieldPrefix = `${optimisticSnapshotKey}:`;

/** Attach reconciliation metadata to an entity record returned by a transport. */
export function withOptimisticSnapshot<T extends object>(
  record: T,
  snapshot: OptimisticSnapshot,
): T {
  // oxlint-disable-next-line quality/no-known-value-widening -- Validate caller-supplied snapshot metadata even when the caller is typed.
  if (!isOptimisticSnapshot(snapshot)) {
    throw new Error('fate: Invalid optimistic snapshot.');
  }
  const { appliedMutationIds, revision } = snapshot;
  return {
    ...record,
    [optimisticSnapshotKey]: {
      ...(appliedMutationIds && { appliedMutationIds: [...appliedMutationIds] }),
      revision,
    },
  };
}

export const isOptimisticSnapshot = (value: unknown): value is OptimisticSnapshot =>
  isRecord(value) &&
  isSnapshotRevision(value.revision) &&
  (value.appliedMutationIds === undefined ||
    (Array.isArray(value.appliedMutationIds) &&
      value.appliedMutationIds.every((id) => typeof id === 'string' && id.length > 0)));

export const readOptimisticSnapshot = (record: AnyRecord) => {
  const value = record[optimisticSnapshotKey];
  return value !== undefined && isOptimisticSnapshot(value) ? value : undefined;
};

export const isSnapshotRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export const optimisticTombstone = (revision: number): AnyRecord => ({
  [optimisticSnapshotKey]: { deleted: true, revision },
});

export const optimisticDeletionRevision = (record: AnyRecord | undefined) => {
  const value = record?.[optimisticSnapshotKey];
  return isRecord(value) && value.deleted === true && isSnapshotRevision(value.revision)
    ? value.revision
    : undefined;
};

/** A recreated record carries the deletion revision as a lower bound on future writes. */
export const optimisticIncarnationFloor = (record: AnyRecord | undefined) => {
  const value = record?.[optimisticSnapshotKey];
  return isRecord(value) && value.deleted === false && isSnapshotRevision(value.revision)
    ? value.revision
    : undefined;
};

export const rememberOptimisticDeletion = (record: AnyRecord, deletion: number | undefined) => {
  if (
    deletion === undefined ||
    optimisticDeletionRevision(record) !== undefined ||
    (optimisticIncarnationFloor(record) ?? -1) >= deletion
  ) {
    return record;
  }
  return { ...record, [optimisticSnapshotKey]: { deleted: false, revision: deletion } };
};

export const latestOptimisticRevision = (record: AnyRecord | undefined) => {
  let latest = optimisticDeletionRevision(record) ?? optimisticIncarnationFloor(record);
  if (record) {
    for (const [key, value] of Object.entries(record)) {
      if (isOptimisticFieldKey(key) && isRecord(value)) {
        const { revision } = value;
        if (isSnapshotRevision(revision) && (latest === undefined || revision > latest)) {
          latest = revision;
        }
      }
    }
  }
  return latest;
};

/** When either record is a tombstone, choose the winning incarnation as a whole. */
export const reconcileOptimisticDeletion = (before: AnyRecord, after: AnyRecord) => {
  const previousDelete = optimisticDeletionRevision(before);
  const nextDelete = optimisticDeletionRevision(after);
  if (previousDelete !== undefined) {
    return (nextDelete ?? latestOptimisticRevision(after) ?? -1) > previousDelete
      ? rememberOptimisticDeletion(after, previousDelete)
      : before;
  }
  if (nextDelete !== undefined) {
    return (latestOptimisticRevision(before) ?? -1) > nextDelete ? before : after;
  }
  const previousFloor = optimisticIncarnationFloor(before);
  const nextFloor = optimisticIncarnationFloor(after);
  if (previousFloor !== undefined && (latestOptimisticRevision(after) ?? -1) <= previousFloor) {
    return before;
  }
  if (nextFloor !== undefined && (latestOptimisticRevision(before) ?? -1) <= nextFloor) {
    return after;
  }
};

export const optimisticFieldKey = (field: string) =>
  fieldPrefix + field.replaceAll('%', '%25').replaceAll('.', '%2E');

export const isOptimisticFieldKey = (field: string) => field.startsWith(fieldPrefix);

export const optimisticFieldPath = (key: string) =>
  key.slice(fieldPrefix.length).replaceAll('%2E', '.').replaceAll('%25', '%');

export const readOptimisticField = (record: AnyRecord | undefined, path: string) => {
  let latest: OptimisticSnapshot | undefined;
  while (record && path) {
    const value = record[optimisticFieldKey(path)] as OptimisticSnapshot | undefined;
    if (value && (!latest || value.revision > latest.revision)) {
      latest = value;
    }
    path = path.slice(0, Math.max(0, path.lastIndexOf('.')));
  }
  return latest;
};

export const hasNewerOptimisticDescendant = (record: AnyRecord, path: string, revision: number) => {
  const prefix = optimisticFieldKey(`${path}.`);
  return Object.keys(record).some(
    (key) => key.startsWith(prefix) && (record[key] as OptimisticSnapshot)?.revision > revision,
  );
};

const restoreField = (merged: AnyRecord, previous: AnyRecord, path: string) => {
  const dot = path.indexOf('.');
  const field = dot === -1 ? path : path.slice(0, dot);
  const oldValue = previous[field];
  const newValue = merged[field];
  if (dot === -1 || !isRecord(oldValue) || !isRecord(newValue)) {
    setRecordValue(merged, field, oldValue);
  } else {
    const value = { ...newValue };
    restoreField(value, oldValue, path.slice(dot + 1));
    setRecordValue(merged, field, value);
  }
};

/** Keep persisted field values paired with their revisions when combining cache records. */
export const preserveNewerOptimisticFields = (previous: AnyRecord, merged: AnyRecord) => {
  for (const key of Object.keys(previous)) {
    if (isOptimisticFieldKey(key)) {
      const path = optimisticFieldPath(key);
      const previousVersion = previous[key] as OptimisticSnapshot;
      const mergedVersion = readOptimisticField(merged, path);
      if (mergedVersion && previousVersion.revision > mergedVersion.revision) {
        restoreField(merged, previous, path);
        merged[key] = previousVersion;
      }
    }
  }
  return merged;
};

export const withoutOptimisticSnapshot = <T>(record: T): T => {
  if (Array.isArray(record)) {
    const items = record.map(withoutOptimisticSnapshot);
    return items.some((item, index) => !Object.is(item, record[index])) ? (items as T) : record;
  }
  if (!isRecord(record)) {
    return record;
  }
  let result: AnyRecord | undefined;
  for (const [key, value] of Object.entries(record)) {
    if (key === optimisticSnapshotKey) {
      result ??= { ...record };
      delete result[key];
      continue;
    }
    const clean = withoutOptimisticSnapshot(value);
    if (!Object.is(clean, value)) {
      result ??= { ...record };
      setRecordValue(result, key, clean);
    }
  }
  return result ? (result as T) : record;
};
