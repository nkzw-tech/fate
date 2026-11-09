import { migrateClientState, type resolveClientStateOptions } from './client-state-migration.ts';
import type { FateClient } from './client.ts';
import { decodeHydrationValue, encodeHydrationValue } from './hydration.ts';
import {
  persistenceEntrySize,
  persistencePageSize,
  yieldPersistenceTask,
} from './persistence-utils.ts';
import type { PersistenceStorage, PersistenceStorageWrite } from './persistence.ts';
import { isRecord } from './record.ts';
import { areHydrationValuesEqual, parseListKey, type List, type StorePreview } from './store.ts';
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

type ClientStatePatch = {
  lists: Map<string, List | null | undefined>;
  records: Map<EntityId, AnyRecord | null | undefined>;
  references: Map<EntityId, ClientStateReference | null | undefined>;
};

const emptySnapshot = (): ClientStateSnapshot => ({
  lists: new Map(),
  records: new Map(),
  references: new Map(),
});

const migratedEntries = <T>(before: ReadonlyMap<string, T>, after: ReadonlyMap<string, T>) => {
  const changes = new Map<string, T | undefined>(after);
  for (const key of before.keys()) {
    if (!after.has(key)) {
      changes.set(key, undefined);
    }
  }
  return changes;
};

const applyEntries = <T>(target: Map<string, T>, changes: ReadonlyMap<string, T | undefined>) => {
  for (const [key, value] of changes) {
    if (value === undefined) {
      target.delete(key);
    } else {
      target.set(key, value);
    }
  }
};

const recordFieldsChanged = (before: AnyRecord, after: AnyRecord) =>
  Object.fromEntries(
    Object.entries(after).filter(
      ([key, value]) =>
        key === 'id' ||
        key === '__typename' ||
        !Object.hasOwn(before, key) ||
        !areHydrationValuesEqual(before[key], value),
    ),
  );

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
      records.set(id, recordFieldsChanged(previous, record));
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

const collections = ['lists', 'records', 'references'] as const;
type Collection = (typeof collections)[number];
type Header = { format: 2; revision: string; version: number };
type Encoded = ReturnType<typeof encodeHydrationValue>;

const invalidState = () => new Error('fate: Invalid persisted client state.');

const isHeader = (value: unknown): value is Header =>
  isRecord(value) &&
  value.format === 2 &&
  typeof value.revision === 'string' &&
  typeof value.version === 'number' &&
  Number.isSafeInteger(value.version) &&
  value.version > 0;

/** The confirmed client graph has its own lifetime, independent of the read cache. */
export class ClientPersistence {
  private readonly storageKey: string;
  private readonly prefix: string;
  private header?: Header;
  private bytes = 0;
  private sizes = new Map<string, number>();
  private referenceCounts = new Map<EntityId, number>();
  private saved = emptySnapshot();

  constructor(
    private readonly client: FateClient<any, any, any>,
    private readonly storage: PersistenceStorage,
    private readonly key: string,
    private readonly options: ReturnType<typeof resolveClientStateOptions>,
  ) {
    this.storageKey = JSON.stringify([key, 'client-state-v2']);
    this.prefix = `${this.storageKey}:`;
  }

  private entryKey(kind: Collection, id: string) {
    return this.prefix + JSON.stringify([kind, id]);
  }

  restore() {
    return this.storage.exclusive(this.storageKey, () => this.load());
  }

  private async loadLegacy() {
    const key = JSON.stringify([
      this.key,
      'client-state-v1',
      this.options.legacyScope ?? this.client.getPersistenceScope(),
    ]);
    await this.storage.exclusive(key, async () => {
      const raw = await this.storage.read(key);
      this.client.assertPersistenceActive();
      if (raw === undefined) {
        return;
      }
      const state = decodeHydrationValue(raw as Encoded);
      if (!isRecord(state)) {
        throw invalidState();
      }
      const next = {
        lists: decodeEntries(state.lists, isList),
        records: decodeEntries(state.records, isRecord),
        references: decodeEntries(state.references ?? [], isReference),
      };
      migrateClientState(next, 1, this.options);
      await this.write(next);
      this.publish(next);
    });
  }

  private async load() {
    const header = await this.storage.read(this.storageKey);
    this.client.assertPersistenceActive();
    if (header === undefined) {
      if (this.header) {
        throw invalidState();
      }
      await this.loadLegacy();
      return;
    }
    if (!isHeader(header)) {
      throw invalidState();
    }
    if (header.version > this.options.version) {
      throw new Error(`fate: Saved client state version ${header.version} requires a newer app.`);
    }
    if (this.header?.revision === header.revision) {
      return;
    }
    const next = emptySnapshot();
    const sizes = new Map<string, number>();
    let bytes = 0;
    let after: string | undefined;
    while (true) {
      const page = await this.storage.scan(this.prefix, after, persistencePageSize);
      this.client.assertPersistenceActive();
      for (const { key, value } of page) {
        const [kind, id] = JSON.parse(key.slice(this.prefix.length)) as [unknown, unknown];
        if (
          typeof id !== 'string' ||
          sizes.has(key) ||
          !isRecord(value) ||
          typeof value.bytes !== 'number' ||
          !Number.isSafeInteger(value.bytes) ||
          value.bytes <= 0
        ) {
          throw invalidState();
        }
        const entry = decodeHydrationValue(value.data as Encoded, this.options.limits);
        if (kind === 'records' && (entry === null || isRecord(entry))) {
          next.records.set(id, entry);
        } else if (kind === 'lists' && (entry === null || isList(entry))) {
          next.lists.set(id, entry);
        } else if (kind === 'references' && (entry === null || isReference(entry))) {
          next.references.set(id, entry);
        } else {
          throw invalidState();
        }
        sizes.set(key, value.bytes);
        bytes += value.bytes;
      }
      if (page.length < persistencePageSize) {
        break;
      }
      after = page.at(-1)!.key;
      await yieldPersistenceTask();
    }
    this.bytes = bytes;
    this.sizes = sizes;
    if (header.version < this.options.version) {
      const previous = {
        lists: new Map(next.lists),
        records: new Map(next.records),
        references: new Map(next.references),
      };
      migrateClientState(next, header.version, this.options);
      await this.write({
        lists: migratedEntries(previous.lists, next.lists),
        records: migratedEntries(previous.records, next.records),
        references: migratedEntries(previous.references, next.references),
      });
    } else {
      this.header = header;
    }
    this.publish(next);
  }

  private publish(next: ClientStateSnapshot) {
    const changes = getChanges(this.saved, next);
    this.referenceCounts.clear();
    for (const record of next.records.values()) {
      if (record) {
        for (const id of this.client.clientReferenceIds(record)) {
          this.referenceCounts.set(id, (this.referenceCounts.get(id) ?? 0) + 1);
        }
      }
    }
    this.client.restoreClientState(next, changes);
    this.saved = next;
  }

  private async write(changes: ClientStatePatch) {
    const writes: Array<PersistenceStorageWrite> = [];
    const sizes = new Map<string, number>();
    let bytes = this.bytes;
    for (const kind of collections) {
      for (const [id, value] of changes[kind]) {
        const key = this.entryKey(kind, id);
        const data =
          value === undefined ? undefined : encodeHydrationValue(value, this.options.limits);
        const size = data === undefined ? 0 : persistenceEntrySize(key, data);
        bytes += size - (this.sizes.get(key) ?? 0);
        sizes.set(key, size);
        // Keep the encoded byte count so cold restores can size entries without re-encoding them.
        writes.push([key, data === undefined ? undefined : { bytes: size, data }]);
      }
    }
    const header = {
      format: 2 as const,
      revision: crypto.randomUUID(),
      version: this.options.version,
    };
    if (bytes + persistenceEntrySize(this.storageKey, header) > this.options.maxBytes) {
      throw new Error('fate: Persisted client state exceeds the storage size limit.');
    }
    this.client.assertPersistenceActive();
    await this.storage.writeBatch([...writes, [this.storageKey, header]]);
    this.bytes = bytes;
    for (const [key, size] of sizes) {
      if (size) {
        this.sizes.set(key, size);
      } else {
        this.sizes.delete(key);
      }
    }
    this.header = header;
  }

  private collectChanges({ lists, records }: StorePreview) {
    const changes: ClientStatePatch = {
      lists: new Map(),
      records: new Map(),
      references: new Map(),
    };
    const referenceDeltas = new Map<EntityId, number>();
    const addReferences = (record: AnyRecord | null | undefined, delta: number) => {
      if (record) {
        for (const id of this.client.clientReferenceIds(record)) {
          referenceDeltas.set(id, (referenceDeltas.get(id) ?? 0) + delta);
        }
      }
    };
    for (const [id, [before, after]] of records) {
      if (this.referenceCounts.has(id)) {
        referenceDeltas.set(id, referenceDeltas.get(id) ?? 0);
      }
      if (before === after) {
        continue;
      }
      const previous = this.client.captureClientRecord(id, before);
      const record = this.client.captureClientRecord(id, after);
      if (areHydrationValuesEqual(previous, record)) {
        continue;
      }
      const saved = this.saved.records.get(id);
      // Merge only fields changed by this mutation, excluding unrelated in-memory edits.
      const next = record
        ? { ...saved, ...(previous ? recordFieldsChanged(previous, record) : record) }
        : this.client.isInitialClientRecord(id)
          ? null
          : undefined;
      if (!areHydrationValuesEqual(saved, next)) {
        changes.records.set(id, next);
        addReferences(saved, -1);
        addReferences(next, 1);
      }
    }
    for (const [key, [before, after]] of lists) {
      if (this.client.isClientStateList(key) && !areHydrationValuesEqual(before, after)) {
        const owner = parseListKey(key);
        const next =
          after ?? (owner && this.client.isInitialClientRecord(owner.ownerId) ? null : undefined);
        if (!areHydrationValuesEqual(this.saved.lists.get(key), next)) {
          changes.lists.set(key, next);
        }
      }
    }
    const counts = new Map<EntityId, number | undefined>();
    for (const [id, delta] of referenceDeltas) {
      const count = (this.referenceCounts.get(id) ?? 0) + delta;
      const reference = count ? this.client.captureClientReference(id) : undefined;
      if (!areHydrationValuesEqual(this.saved.references.get(id), reference)) {
        changes.references.set(id, reference);
      }
      if (delta) {
        counts.set(id, count || undefined);
      }
    }
    return { changes, counts };
  }

  mutate<T>(run: (commit: (apply: () => void) => Promise<void>) => Promise<T>) {
    return this.storage.exclusive(this.storageKey, async () => {
      // Read under the same lock as the write so read-modify-write actions see
      // commits from other tabs even when the tab never got a notification.
      await this.load();
      return run(async (apply) => {
        const { changes, counts } = this.client.previewClientMutation(apply, (preview) =>
          this.collectChanges(preview),
        );
        if (!changes.records.size && !changes.lists.size && !changes.references.size) {
          apply();
          return;
        }
        await this.write(changes);
        this.client.assertPersistenceActive();
        try {
          apply();
        } finally {
          applyEntries(this.saved.lists, changes.lists);
          applyEntries(this.saved.records, changes.records);
          applyEntries(this.saved.references, changes.references);
          applyEntries(this.referenceCounts, counts);
          this.client.restoreClientState(this.saved, emptySnapshot());
        }
      });
    });
  }
}
