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

const collections = ['lists', 'records', 'references'] as const;
type Collection = (typeof collections)[number];
type Header = { format: 2; revision: string; version: number };

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
      const state = decodeHydrationValue(raw as ReturnType<typeof encodeHydrationValue>);
      if (!isRecord(state)) {
        throw invalidState();
      }
      const next = {
        lists: decodeEntries(state.lists, isList),
        records: decodeEntries(state.records, isRecord),
        references: decodeEntries(state.references ?? [], isReference),
      };
      migrateClientState(next, 1, this.options);
      await this.write(next, emptySnapshot());
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
        if (typeof id !== 'string' || sizes.has(key)) {
          throw invalidState();
        }
        const entry = decodeHydrationValue(
          value as ReturnType<typeof encodeHydrationValue>,
          this.options.limits,
        );
        if (kind === 'records' && (entry === null || isRecord(entry))) {
          next.records.set(id, entry);
        } else if (kind === 'lists' && (entry === null || isList(entry))) {
          next.lists.set(id, entry);
        } else if (kind === 'references' && (entry === null || isReference(entry))) {
          next.references.set(id, entry);
        } else {
          throw invalidState();
        }
        const size = persistenceEntrySize(key, value);
        sizes.set(key, size);
        bytes += size;
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
      await this.write(next, previous, true);
    } else {
      this.header = header;
    }
    this.publish(next);
  }

  private publish(next: ClientStateSnapshot) {
    const changes = getChanges(this.saved, next);
    this.client.restoreClientState(next, changes);
    this.saved = next;
  }

  private async write(next: ClientStateSnapshot, previous = this.saved, force = false) {
    const writes: Array<PersistenceStorageWrite> = [];
    const sizes = new Map<string, number>();
    let bytes = this.bytes;
    const stage = (key: string, value: unknown) => {
      const size = value === undefined ? 0 : persistenceEntrySize(key, value);
      bytes += size - (this.sizes.get(key) ?? 0);
      sizes.set(key, size);
      writes.push([key, value]);
    };
    for (const kind of collections) {
      for (const [id, value] of next[kind]) {
        if (force || !areHydrationValuesEqual(previous[kind].get(id), value)) {
          stage(this.entryKey(kind, id), encodeHydrationValue(value, this.options.limits));
        }
      }
      for (const id of previous[kind].keys()) {
        if (!next[kind].has(id)) {
          stage(this.entryKey(kind, id), undefined);
        }
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

  mutate<T>(run: (commit: (apply: () => void) => Promise<void>) => Promise<T>) {
    return this.storage.exclusive(this.storageKey, async () => {
      // Read under the same lock as the write so read-modify-write actions see
      // commits from other tabs even when the tab never got a notification.
      await this.load();
      return run(async (apply) => {
        const before = this.client.captureClientState();
        const next = this.client.previewClientMutation(() => {
          apply();
          const after = this.client.captureClientState();
          const changes = getChanges(before, after);
          const next: ClientStateSnapshot = {
            lists: new Map(this.saved.lists),
            records: new Map(this.saved.records),
            references: new Map(),
          };
          for (const [id, record] of changes.records) {
            if (record) {
              next.records.set(id, { ...next.records.get(id), ...record });
            } else if (this.client.isInitialClientRecord(id)) {
              next.records.set(id, null);
            } else {
              next.records.delete(id);
            }
          }
          for (const [listKey, list] of changes.lists) {
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
            changes.records.size ||
            changes.lists.size ||
            changedEntries(this.saved.references, next.references).size
          ) {
            return next;
          }
        });
        if (!next) {
          apply();
          return;
        }
        await this.write(next);
        this.saved = next;
        this.client.assertPersistenceActive();
        apply();
        this.client.restoreClientState(next, emptySnapshot());
      });
    });
  }
}
