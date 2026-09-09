import type { FateDehydratedState, encodeHydrationValue } from './hydration.ts';
import {
  persistenceEntrySize,
  persistencePageSize,
  yieldPersistenceTask,
} from './persistence-utils.ts';
import type { PersistenceStorage } from './persistence.ts';

type Encoded = ReturnType<typeof encodeHydrationValue>;
type JournalError = { message: string; status?: number };
type JournalEntryBase = {
  attempts: number;
  command: Encoded;
  error?: JournalError;
  id: string;
  scope: string;
};
export type PendingJournalEntry = JournalEntryBase & {
  base?: FateDehydratedState;
  nextAttemptAt?: number;
  status: 'queued' | 'sending';
};
export type FailedJournalEntry = JournalEntryBase & {
  error: JournalError;
  status: 'failed';
};
export type ConfirmedJournalEntry = JournalEntryBase & {
  cacheUpdates: Encoded;
  result: Encoded;
  status: 'confirmed';
};
export type JournalEntry = PendingJournalEntry | FailedJournalEntry | ConfirmedJournalEntry;
export type JournalData = { mutations: Array<JournalEntry> };
type Header = { nextSequence: number; revision: string; version: 2 };
type StoredJournalEntry = { bytes: number; entry: JournalEntry; key: string };
export type JournalWritePlan = {
  bytes: number;
  entries: Map<string, StoredJournalEntry>;
  header: Header;
  writes: Array<readonly [string, unknown]>;
};
const invalid = () =>
  new Error('fate: Unsupported or corrupt persistence data. It has not been overwritten.');
const valid = (value: unknown): value is JournalEntry => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.id !== 'string' ||
    typeof entry.scope !== 'string' ||
    !Number.isInteger(entry.attempts) ||
    (entry.attempts as number) < 0
  ) {
    return false;
  }
  if (entry.status === 'failed') {
    return (
      !!entry.error &&
      typeof entry.error === 'object' &&
      typeof (entry.error as Record<string, unknown>).message === 'string'
    );
  }
  if (entry.status === 'confirmed') {
    return 'cacheUpdates' in entry && 'result' in entry;
  }
  return entry.status === 'queued' || entry.status === 'sending';
};
// load() returns shallow entry copies, so unchanged encoded payloads retain their
// identity while direct journal-field updates are still detected cheaply.
const hasSameFields = (left: JournalEntry, right: JournalEntry) => {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)] as Array<keyof JournalEntry>);
  return [...keys].every((key) => left[key] === right[key]);
};
/** All methods run under the account's write lock, including reads across scan pages. */
export class PersistenceJournal {
  private disposed = false;
  private header?: Header;
  private entries = new Map<string, StoredJournalEntry>();
  private readonly prefix: string;

  constructor(
    private readonly storage: PersistenceStorage,
    private readonly key: string,
    private readonly validate?: (entry: JournalEntry) => void,
  ) {
    this.prefix = `${JSON.stringify([key, 'journal'])}:`;
  }

  dispose() {
    this.disposed = true;
    this.entries.clear();
  }

  private assertActive() {
    if (this.disposed) {
      throw new Error('fate: Persistence was disposed.');
    }
  }

  async load(): Promise<JournalData> {
    this.assertActive();
    const value = (await this.storage.read(this.key)) as
      | Header
      | { mutations: Array<JournalEntry>; version: 1 }
      | undefined;
    this.assertActive();
    if (value == null) {
      this.header = undefined;
      this.entries.clear();
    } else if (value.version === 1) {
      if (
        !Array.isArray(value.mutations) ||
        value.mutations.some((entry) => !valid(entry)) ||
        new Set(value.mutations.map(({ id }) => id)).size !== value.mutations.length
      ) {
        throw invalid();
      }
      let checked = 0;
      for (const entry of value.mutations) {
        this.validate?.(entry);
        if (++checked % persistencePageSize === 0) {
          await yieldPersistenceTask();
          this.assertActive();
        }
      }
      // Publish the new header and entries atomically. An interrupted migration
      // leaves the original journal intact, including its recovery patches.
      this.header = undefined;
      this.entries.clear();
      await this.save({ mutations: value.mutations });
    } else if (
      value.version !== 2 ||
      typeof value.revision !== 'string' ||
      !Number.isSafeInteger(value.nextSequence) ||
      value.nextSequence < 0
    ) {
      throw invalid();
    } else if (this.header?.revision !== value.revision) {
      const entries = new Map<string, StoredJournalEntry>();
      let after: string | undefined;
      while (true) {
        const page = await this.storage.scan(this.prefix, after, persistencePageSize);
        this.assertActive();
        for (const { key, value } of page) {
          const stored = value as Omit<StoredJournalEntry, 'key'>;
          if (
            !stored ||
            !valid(stored.entry) ||
            !Number.isSafeInteger(stored.bytes) ||
            stored.bytes <= 0 ||
            entries.has(stored.entry.id)
          ) {
            throw invalid();
          }
          this.validate?.(stored.entry);
          entries.set(stored.entry.id, { ...stored, key });
        }
        if (page.length < persistencePageSize) {
          break;
        }
        after = page.at(-1)!.key;
        await yieldPersistenceTask();
      }
      this.assertActive();
      this.header = value;
      this.entries = entries;
    }
    return { mutations: [...this.entries.values()].map(({ entry }) => ({ ...entry })) };
  }

  async prepare(data: JournalData): Promise<JournalWritePlan> {
    this.assertActive();
    const header: Header = {
      nextSequence: this.header?.nextSequence ?? 0,
      revision: crypto.randomUUID(),
      version: 2,
    };
    const entries = new Map<string, StoredJournalEntry>();
    const writes: Array<readonly [string, unknown]> = [];
    let bytes = 0;
    let count = 0;
    for (const entry of data.mutations) {
      const previous = this.entries.get(entry.id);
      let stored = previous;
      if (!previous || !hasSameFields(previous.entry, entry)) {
        const key =
          previous?.key ??
          `${this.prefix}${String(header.nextSequence++).padStart(16, '0')}:${entry.id}`;
        const value = { bytes: 0, entry };
        let measured = persistenceEntrySize(key, value);
        while (measured !== value.bytes) {
          value.bytes = measured;
          measured = persistenceEntrySize(key, value);
        }
        stored = { ...value, entry: { ...entry }, key };
        writes.push([key, value]);
      }
      entries.set(entry.id, stored!);
      bytes += stored!.bytes;
      if (++count % persistencePageSize === 0) {
        await yieldPersistenceTask();
        this.assertActive();
      }
    }
    for (const [id, { key }] of this.entries) {
      if (!entries.has(id)) {
        writes.push([key, undefined]);
      }
    }
    bytes += persistenceEntrySize(this.key, header);
    return { bytes, entries, header, writes };
  }

  async commit(plan: JournalWritePlan) {
    this.assertActive();
    if (plan.writes.length || !this.header) {
      await this.storage.writeBatch([...plan.writes, [this.key, plan.header]]);
      this.assertActive();
      this.header = plan.header;
      this.entries = plan.entries;
    }
  }

  async save(data: JournalData) {
    await this.commit(await this.prepare(data));
  }
}
