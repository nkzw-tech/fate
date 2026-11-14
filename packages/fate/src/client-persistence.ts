import { migrateClientState, type resolveClientStateOptions } from './client-state-migration.ts';
import type { FateClient } from './client.ts';
import { decodeHydrationValue, encodeHydrationValue } from './hydration.ts';
import {
  persistenceEntrySize,
  persistencePageSize,
  readPersistenceBatch,
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
type ChangedEntry = readonly [Collection, string];
type History = { base: string; batches: Array<{ entries: Array<ChangedEntry>; revision: string }> };
type Header = { format: 2; history?: History; revision: string; version: number };
type Encoded = ReturnType<typeof encodeHydrationValue>;

const invalidState = () => new Error('fate: Invalid persisted client state.');

const isHeader = (value: unknown): value is Header =>
  isRecord(value) &&
  value.format === 2 &&
  typeof value.revision === 'string' &&
  typeof value.version === 'number' &&
  Number.isSafeInteger(value.version) &&
  value.version > 0;

// History is an optional acceleration hint. Older writers omit it, and readers
// fall back to a full scan if its chain is absent, truncated, or malformed.
const readHistory = (header: Header): History | undefined => {
  const history = header.history;
  if (
    !isRecord(history) ||
    typeof history.base !== 'string' ||
    !Array.isArray(history.batches) ||
    !history.batches.length ||
    history.batches.length > 16
  ) {
    return;
  }
  const revisions = new Set([history.base]);
  let entries = 0;
  for (const batch of history.batches) {
    if (
      !isRecord(batch) ||
      typeof batch.revision !== 'string' ||
      revisions.has(batch.revision) ||
      !Array.isArray(batch.entries) ||
      !batch.entries.every(
        (entry: unknown) =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          collections.includes(entry[0]) &&
          typeof entry[1] === 'string',
      )
    ) {
      return;
    }
    revisions.add(batch.revision);
    entries += batch.entries.length;
  }
  return entries <= 256 && history.batches.at(-1)?.revision === header.revision
    ? history
    : undefined;
};

const decodeEntry = (
  kind: Collection,
  value: unknown,
  limits: Parameters<typeof decodeHydrationValue>[1],
) => {
  if (!isRecord(value) || !Number.isSafeInteger(value.bytes) || (value.bytes as number) <= 0) {
    throw invalidState();
  }
  const entry = decodeHydrationValue(value.data as Encoded, limits);
  if (
    entry !== null &&
    !(kind === 'lists'
      ? isList(entry)
      : kind === 'references'
        ? isReference(entry)
        : isRecord(entry))
  ) {
    throw invalidState();
  }
  return { bytes: value.bytes as number, entry };
};

/** The confirmed client graph has its own lifetime, independent of the read cache. */
export class ClientPersistence {
  private readonly storageKey: string;
  private readonly prefix: string;
  private header?: Header;
  private bytes = 0;
  private sizes = new Map<string, number>();
  private referenceCounts = new Map<EntityId, number>();
  private dirtyReferences = new Set<EntityId>();
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

  recordChanged(id: EntityId, referencesChanged: boolean) {
    if (this.referenceCounts.has(id) || this.client.hasClientReference(id)) {
      this.dirtyReferences.add(id);
    }
    if (referencesChanged) {
      this.trackRecordReferences(id, this.client.store.readConfirmed(id)?.record);
    }
  }

  trackRecordReferences(id: EntityId, record: AnyRecord | undefined) {
    const owned = this.client.captureClientRecord(id, record);
    if (owned) {
      for (const target of this.client.clientReferenceIds(owned)) {
        this.dirtyReferences.add(target);
      }
    }
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
    if (
      this.header?.version === header.version &&
      header.version === this.options.version &&
      (await this.loadChanges(header))
    ) {
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

  private async loadChanges(header: Header): Promise<boolean> {
    const history = readHistory(header);
    if (!history || !this.header) {
      return false;
    }
    const index =
      history.base === this.header.revision
        ? 0
        : history.batches.findIndex(({ revision }) => revision === this.header!.revision) + 1;
    if (index === 0 && history.base !== this.header.revision) {
      return false;
    }
    const entries = new Map<string, ChangedEntry>();
    for (const batch of history.batches.slice(index)) {
      for (const entry of batch.entries) {
        entries.set(this.entryKey(...entry), entry);
      }
    }
    const keys = [...entries.keys()];
    const patch: ClientStatePatch = { lists: new Map(), records: new Map(), references: new Map() };
    const previous: ClientStatePatch = {
      lists: new Map(),
      records: new Map(),
      references: new Map(),
    };
    const before = emptySnapshot();
    const after = emptySnapshot();
    const sizes = new Map<string, number>();
    let bytes = this.bytes;
    for (let start = 0; start < keys.length; start += 32) {
      const batch = keys.slice(start, start + 32);
      const values = await readPersistenceBatch(this.storage, batch);
      this.client.assertPersistenceActive();
      batch.forEach((key, index) => {
        const [kind, id] = entries.get(key)!;
        const value = values[index];
        const decoded =
          value === undefined ? undefined : decodeEntry(kind, value, this.options.limits);
        const size = decoded?.bytes ?? 0;
        bytes += size - (this.sizes.get(key) ?? 0);
        sizes.set(key, size);
        // Validation above narrows each collection's value; the maps share the
        // same update algorithm while retaining their specific public types.
        const saved = this.saved[kind].get(id);
        (previous[kind] as Map<string, unknown>).set(id, saved);
        (patch[kind] as Map<string, unknown>).set(id, decoded?.entry);
        if (saved !== undefined) {
          (before[kind] as Map<string, unknown>).set(id, saved);
        }
        if (decoded) {
          (after[kind] as Map<string, unknown>).set(id, decoded.entry);
        }
      });
    }
    const changes = getChanges(before, after);
    const referenceDeltas = new Map<EntityId, number>();
    for (const [records, delta] of [
      [before.records, -1],
      [after.records, 1],
    ] as const) {
      for (const record of records.values()) {
        if (record) {
          for (const id of this.client.clientReferenceIds(record)) {
            referenceDeltas.set(id, (referenceDeltas.get(id) ?? 0) + delta);
          }
        }
      }
    }
    const apply = (changes: ClientStatePatch) => {
      applyEntries(this.saved.lists, changes.lists);
      applyEntries(this.saved.records, changes.records);
      applyEntries(this.saved.references, changes.references);
    };
    apply(patch);
    try {
      this.client.restoreClientState(this.saved, changes);
    } catch (error) {
      apply(previous);
      this.client.restoreClientState(this.saved, emptySnapshot());
      throw error;
    }
    for (const [id, delta] of referenceDeltas) {
      const count = (this.referenceCounts.get(id) ?? 0) + delta;
      if (count) {
        this.referenceCounts.set(id, count);
      } else {
        this.referenceCounts.delete(id);
      }
    }
    for (const [key, size] of sizes) {
      if (size) {
        this.sizes.set(key, size);
      } else {
        this.sizes.delete(key);
      }
    }
    this.bytes = bytes;
    this.header = header;
    return true;
  }

  private async write(changes: ClientStatePatch) {
    const writes: Array<PersistenceStorageWrite> = [];
    const changed: Array<ChangedEntry> = [];
    const sizes = new Map<string, number>();
    let bytes = this.bytes;
    for (const kind of collections) {
      for (const [id, value] of changes[kind]) {
        changed.push([kind, id]);
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
    const header: Header = {
      format: 2 as const,
      revision: crypto.randomUUID(),
      version: this.options.version,
    };
    if (this.header && this.header.version === header.version) {
      const previous = readHistory(this.header);
      const batches = [
        ...(previous?.batches ?? []),
        { entries: changed, revision: header.revision },
      ];
      header.history = { base: previous?.base ?? this.header.revision, batches };
      while (
        batches.length &&
        (batches.length > 16 ||
          batches.reduce((size, batch) => size + batch.entries.length, 0) > 256 ||
          persistenceEntrySize(this.storageKey, header.history) > 16_384 ||
          bytes + persistenceEntrySize(this.storageKey, header) > this.options.maxBytes)
      ) {
        header.history.base = batches.shift()!.revision;
      }
      if (!batches.length) {
        delete header.history;
      }
    }
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
    const referenceDeltas = new Map<EntityId, number>(
      [...this.dirtyReferences].map((id) => [id, 0]),
    );
    const addReferences = (record: AnyRecord | null | undefined, delta: number) => {
      if (record) {
        for (const id of this.client.clientReferenceIds(record)) {
          referenceDeltas.set(id, (referenceDeltas.get(id) ?? 0) + delta);
        }
      }
    };
    for (const [id, [before, after]] of records) {
      if (before === after) {
        continue;
      }
      if (this.referenceCounts.has(id) || this.client.hasClientReference(id)) {
        referenceDeltas.set(id, referenceDeltas.get(id) ?? 0);
      }
      const previous = this.client.captureClientRecord(id, before);
      const record = this.client.captureClientRecord(id, after);
      if (areHydrationValuesEqual(previous, record)) {
        continue;
      }
      // Defaults are live client fields even when they have no saved record patch.
      addReferences(previous, 0);
      addReferences(record, 0);
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
      const reference =
        count || this.client.hasClientReference(id)
          ? this.client.captureClientReference(id)
          : undefined;
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
        const dirty = this.dirtyReferences;
        this.dirtyReferences = new Set();
        if (!changes.records.size && !changes.lists.size && !changes.references.size) {
          apply();
          return;
        }
        try {
          await this.write(changes);
        } catch (error) {
          for (const id of dirty) {
            this.dirtyReferences.add(id);
          }
          throw error;
        }
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
