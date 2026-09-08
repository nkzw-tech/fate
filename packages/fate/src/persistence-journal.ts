import type { FateDehydratedState, encodeHydrationValue } from './hydration.ts';
import type { PersistenceStorage } from './persistence.ts';

type Encoded = ReturnType<typeof encodeHydrationValue>;
export type JournalEntry = {
  attempts: number;
  base?: FateDehydratedState;
  cacheUpdates?: Encoded;
  command: Encoded;
  error?: { message: string; status?: number };
  id: string;
  nextAttemptAt?: number;
  result?: Encoded;
  scope: string;
  status: 'queued' | 'sending' | 'failed' | 'confirmed';
};
export type JournalData = { mutations: Array<JournalEntry> };
type Header = { nextSequence: number; revision: string; version: 2 };
type Stored = { bytes: number; entry: JournalEntry; key: string };
const invalid = () =>
  new Error('fate: Unsupported or corrupt persistence data. It has not been overwritten.');
const valid = (entry: JournalEntry) =>
  entry &&
  typeof entry.id === 'string' &&
  typeof entry.scope === 'string' &&
  ['queued', 'sending', 'failed', 'confirmed'].includes(entry.status) &&
  Number.isInteger(entry.attempts) &&
  entry.attempts >= 0;
const same = (left: JournalEntry, right: JournalEntry) => {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)] as Array<keyof JournalEntry>);
  return [...keys].every((key) => left[key] === right[key]);
};
const size = (key: string, value: unknown) =>
  new TextEncoder().encode(JSON.stringify([key, value])).byteLength;
const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** All methods run under the account's write lock, including reads across scan pages. */
export class PersistenceJournal {
  private disposed = false;
  private header?: Header;
  private entries = new Map<string, Stored>();
  private prepared?: {
    bytes: number;
    data: JournalData;
    entries: Map<string, Stored>;
    header: Header;
    writes: Array<readonly [string, unknown]>;
  };
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
    this.prepared = undefined;
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
        if (++checked % 64 === 0) {
          await yieldTask();
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
      const entries = new Map<string, Stored>();
      let after: string | undefined;
      while (true) {
        const page = await this.storage.scan(this.prefix, after, 64);
        this.assertActive();
        for (const { key, value } of page) {
          const stored = value as Omit<Stored, 'key'>;
          if (
            !stored ||
            !valid(stored.entry) ||
            !Number.isSafeInteger(stored.bytes) ||
            stored.bytes <= 0 ||
            entries.has(stored.entry.id)
          ) {
            throw invalid();
          }
          entries.set(stored.entry.id, { ...stored, key });
        }
        if (page.length < 64) {
          break;
        }
        after = page.at(-1)!.key;
        await yieldTask();
      }
      this.assertActive();
      this.header = value;
      this.entries = entries;
    }
    this.prepared = undefined;
    return { mutations: [...this.entries.values()].map(({ entry }) => ({ ...entry })) };
  }

  async measure(data: JournalData) {
    this.assertActive();
    const header: Header = {
      nextSequence: this.header?.nextSequence ?? 0,
      revision: crypto.randomUUID(),
      version: 2,
    };
    const entries = new Map<string, Stored>();
    const writes: Array<readonly [string, unknown]> = [];
    let bytes = 0;
    let count = 0;
    for (const entry of data.mutations) {
      const previous = this.entries.get(entry.id);
      let stored = previous;
      if (!previous || !same(previous.entry, entry)) {
        const key =
          previous?.key ??
          `${this.prefix}${String(header.nextSequence++).padStart(16, '0')}:${entry.id}`;
        const value = { bytes: 0, entry };
        let measured = size(key, value);
        while (measured !== value.bytes) {
          value.bytes = measured;
          measured = size(key, value);
        }
        stored = { ...value, entry: { ...entry }, key };
        writes.push([key, value]);
      }
      entries.set(entry.id, stored!);
      bytes += stored!.bytes;
      if (++count % 64 === 0) {
        await yieldTask();
        this.assertActive();
      }
    }
    for (const [id, { key }] of this.entries) {
      if (!entries.has(id)) {
        writes.push([key, undefined]);
      }
    }
    bytes += size(this.key, header);
    this.prepared = { bytes, data, entries, header, writes };
    return bytes;
  }

  async save(data: JournalData) {
    this.assertActive();
    if (this.prepared?.data !== data) {
      await this.measure(data);
    }
    this.assertActive();
    const prepared = this.prepared!;
    if (prepared.writes.length || !this.header) {
      await this.storage.writeBatch([...prepared.writes, [this.key, prepared.header]]);
      this.assertActive();
      this.header = prepared.header;
      this.entries = prepared.entries;
    }
    this.prepared = undefined;
  }
}
