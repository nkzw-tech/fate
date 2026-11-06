import type { FateClient } from './client.ts';
import { decodeHydrationValue, encodeHydrationValue } from './hydration.ts';
import { persistenceEntrySize } from './persistence-utils.ts';
import type { PersistenceStorage } from './persistence.ts';
import { isRecord } from './record.ts';
import { areHydrationValuesEqual, parseListKey, type List } from './store.ts';
import type { AnyRecord, EntityId } from './types.ts';

export type ClientStateReference = {
  id: string | number;
  record: AnyRecord;
};

export type ClientStateSnapshot = {
  lists: Map<string, List | null>;
  records: Map<EntityId, AnyRecord | null>;
  references: Map<EntityId, ClientStateReference | null>;
};

const emptySnapshot = (): ClientStateSnapshot => ({
  lists: new Map(),
  records: new Map(),
  references: new Map(),
});

const changedEntries = <T>(
  before: ReadonlyMap<string, T | null>,
  after: ReadonlyMap<string, T | null>,
): Map<string, T | null> => {
  const changes = new Map<string, T | null>();
  for (const [key, value] of after) {
    if (!areHydrationValuesEqual(before.get(key), value)) {
      changes.set(key, value);
    }
  }
  for (const key of before.keys()) {
    if (!after.has(key)) {
      changes.set(key, null);
    }
  }
  return changes;
};

const getChanges = (
  before: ClientStateSnapshot,
  after: ClientStateSnapshot,
): ClientStateSnapshot => {
  const records = changedEntries(before.records, after.records);
  for (const [id, record] of records) {
    const previous = before.records.get(id);
    if (record && previous) {
      // Preserve fields intentionally changed only in memory by persist: false.
      records.set(
        id,
        Object.fromEntries(
          Object.entries(record).filter(
            ([key, value]) =>
              key === 'id' ||
              key === '__typename' ||
              !Object.hasOwn(previous, key) ||
              !areHydrationValuesEqual(previous[key], value),
          ),
        ),
      );
    }
  }
  return {
    lists: changedEntries(before.lists, after.lists),
    records,
    references: changedEntries(before.references, after.references),
  };
};

const decodeEntries = <T>(
  entries: unknown,
  validate: (value: unknown) => value is T,
): Map<string, T | null> => {
  if (!Array.isArray(entries)) {
    throw new Error('fate: Invalid persisted client state.');
  }
  const result = new Map<string, T | null>();
  for (const entry of entries) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      result.has(entry[0]) ||
      (entry[1] !== null && !validate(entry[1]))
    ) {
      throw new Error('fate: Invalid persisted client state entry.');
    }
    result.set(entry[0], entry[1]);
  }
  return result;
};

const isList = (value: unknown): value is List =>
  isRecord(value) && Array.isArray(value.ids) && value.ids.every((id) => typeof id === 'string');

const isReference = (value: unknown): value is ClientStateReference =>
  isRecord(value) &&
  (typeof value.id === 'string' || typeof value.id === 'number') &&
  isRecord(value.record);

/** The confirmed client graph has its own lifetime, independent of the read cache. */
export class ClientPersistence {
  private readonly pendingRecords = new Map<EntityId, AnyRecord | null>();
  private readonly pendingLists = new Map<string, List | null>();
  private saved = emptySnapshot();

  constructor(
    private readonly client: FateClient<any, any, any>,
    private readonly storage: PersistenceStorage,
    private readonly key: string,
    private readonly maxBytes: number,
  ) {}

  private storageKey() {
    return JSON.stringify([this.key, 'client-state-v1', this.client.getPersistenceScope()]);
  }

  async restore(key = this.storageKey()) {
    const raw = await this.storage.read(key);
    this.client.assertPersistenceActive();
    const state =
      raw === undefined
        ? undefined
        : decodeHydrationValue(raw as ReturnType<typeof encodeHydrationValue>);
    if (state !== undefined && !isRecord(state)) {
      throw new Error('fate: Invalid persisted client state.');
    }
    const next = state
      ? {
          lists: decodeEntries(state.lists, isList),
          records: decodeEntries(state.records, isRecord),
          references: decodeEntries(state.references ?? [], isReference),
        }
      : emptySnapshot();
    const changes = getChanges(this.saved, next);
    this.client.restoreClientState(next, changes);
    // Restored edits supersede failed patches for the same fields. Retain
    // unrelated patches so a retry still saves changes that only exist in memory.
    for (const [id, record] of changes.records) {
      const pending = this.pendingRecords.get(id);
      if (!record || !pending) {
        this.pendingRecords.delete(id);
        continue;
      }
      for (const key of Object.keys(record)) {
        delete pending[key];
      }
      if (!Object.keys(pending).length) {
        this.pendingRecords.delete(id);
      }
    }
    for (const key of changes.lists.keys()) {
      this.pendingLists.delete(key);
    }
    this.saved = next;
  }

  mutate<T>(run: (commit: (apply: () => void) => Promise<void>) => Promise<T>) {
    const key = this.storageKey();
    return this.storage.exclusive(key, async () => {
      // Read under the same lock as the write so read-modify-write actions see
      // commits from other tabs even when the tab never got a notification.
      await this.restore(key);
      return run(async (apply) => {
        const before = this.client.captureClientState();
        apply();
        const after = this.client.captureClientState();
        const changes = getChanges(before, after);
        // Keep unsaved patches until the disk commit succeeds. A retry can be
        // a no-op in memory after a failed write applied these same values.
        for (const [id, record] of changes.records) {
          this.pendingRecords.set(
            id,
            record ? { ...this.pendingRecords.get(id), ...record } : null,
          );
        }
        for (const [key, list] of changes.lists) {
          this.pendingLists.set(key, list);
        }
        const next: ClientStateSnapshot = {
          lists: new Map(this.saved.lists),
          records: new Map(this.saved.records),
          references: new Map(),
        };
        for (const [id, record] of this.pendingRecords) {
          if (record) {
            next.records.set(id, { ...next.records.get(id), ...record });
          } else if (this.client.isInitialClientRecord(id)) {
            next.records.set(id, null);
          } else {
            next.records.delete(id);
          }
        }
        for (const [listKey, list] of this.pendingLists) {
          const owner = parseListKey(listKey);
          if (list || (owner && this.client.isInitialClientRecord(owner.ownerId))) {
            next.lists.set(listKey, list);
          } else {
            next.lists.delete(listKey);
          }
        }
        // Keep locators for saved relationships even if persist: false changed
        // their in-memory owners. Current defaults can also reference server data.
        next.references = this.client.captureClientReferences([
          ...next.records.values(),
          ...after.records.values(),
        ]);
        if (
          !this.pendingRecords.size &&
          !this.pendingLists.size &&
          !changedEntries(this.saved.references, next.references).size
        ) {
          return;
        }
        const encoded = encodeHydrationValue({
          lists: [...next.lists],
          records: [...next.records],
          references: [...next.references],
        });
        if (persistenceEntrySize(key, encoded) > this.maxBytes) {
          throw new Error('fate: Persisted client state exceeds the storage size limit.');
        }
        this.client.assertPersistenceActive();
        await this.storage.writeBatch([[key, encoded]]);
        this.pendingRecords.clear();
        this.pendingLists.clear();
        this.saved = next;
        this.client.restoreClientState(next, emptySnapshot());
      });
    });
  }
}
