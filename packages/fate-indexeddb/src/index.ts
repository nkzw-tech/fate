import type { PersistenceStorage } from '@nkzw/fate/persistence';
import { openDB } from 'idb';

export type IndexedDBStorageOptions = Readonly<{ name?: string }>;

// IndexedDB sorts strings by UTF-16 code units.
const prefixEnd = (prefix: string) => {
  for (let index = prefix.length - 1; index >= 0; index--) {
    const unit = prefix.charCodeAt(index);
    if (unit < 0xff_ff) {
      return prefix.slice(0, index) + String.fromCharCode(unit + 1);
    }
  }
};

export function createIndexedDBStorage({
  name = 'fate',
}: IndexedDBStorageOptions = {}): PersistenceStorage {
  let connectionLeases = 0;
  let connection: ReturnType<typeof openDB> | undefined;
  const releaseDatabase = () => {
    if (--connectionLeases === 0) {
      const previous = connection;
      connection = undefined;
      void previous?.then(
        (db) => db.close(),
        () => {},
      );
    }
  };
  const acquireDatabase = async () => {
    connectionLeases++;
    try {
      return await (connection ??= openDB(name, 1, {
        upgrade(db) {
          db.createObjectStore('fate');
        },
      }));
    } catch (error) {
      releaseDatabase();
      throw error;
    }
  };
  const listeners = new Map<string, Set<() => void>>();
  let channel: BroadcastChannel | undefined;
  const notify = (key: string) => {
    for (const listener of listeners.get(key) ?? []) {
      try {
        listener();
      } catch {
        /* Observers cannot turn a committed write into a failed write. */
      }
    }
  };
  const broadcast = (keys: Array<string>) => {
    try {
      const sender =
        channel ??
        (typeof BroadcastChannel !== 'undefined'
          ? new BroadcastChannel(`fate:${name}`)
          : undefined);
      try {
        sender?.postMessage(keys);
      } finally {
        if (sender !== channel) {
          sender?.close();
        }
      }
    } catch {
      /* Notifications are best effort; delivery also reconciles the journal. */
    }
    for (const key of keys) {
      notify(key);
    }
  };
  return {
    exclusive(key, run) {
      if (typeof navigator === 'undefined' || !navigator.locks) {
        throw new Error(
          'fate(indexeddb): Web Locks are required for safe durable writes across tabs.',
        );
      }
      return navigator.locks.request(`fate:${JSON.stringify([name, key])}`, async () => {
        // A cache traversal performs many small transactions. Reuse its database
        // connection for the lock's lifetime, and close it when all work finishes.
        connectionLeases++;
        try {
          return await run();
        } finally {
          releaseDatabase();
        }
      });
    },
    async read(key) {
      const db = await acquireDatabase();
      try {
        return await db.get('fate', key);
      } finally {
        releaseDatabase();
      }
    },
    async scan(prefix, after, limit = 64) {
      const lowerOpen = after !== undefined && after >= prefix;
      const lower = lowerOpen ? after : prefix;
      if (!(limit > 0) || !lower.startsWith(prefix)) {
        return [];
      }
      const upper = prefixEnd(prefix);
      const range =
        upper === undefined
          ? IDBKeyRange.lowerBound(lower, lowerOpen)
          : IDBKeyRange.bound(lower, upper, lowerOpen, true);
      const count = Math.min(Math.ceil(limit), 0xff_ff_ff_ff);
      const db = await acquireDatabase();
      try {
        const transaction = db.transaction('fate');
        const [keys, values] = await Promise.all([
          transaction.store.getAllKeys(range, count),
          transaction.store.getAll(range, count),
          transaction.done,
        ]);
        return keys.map((key, index) => ({ key: String(key), value: values[index] }));
      } finally {
        releaseDatabase();
      }
    },
    subscribe(key, listener) {
      if (!channel && typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(`fate:${name}`);
        channel.onmessage = ({ data }) => {
          for (const key of Array.isArray(data) ? data : [data]) {
            if (typeof key === 'string') {
              notify(key);
            }
          }
        };
      }
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (!set.size) {
          listeners.delete(key);
        }
        if (!listeners.size) {
          channel?.close();
          channel = undefined;
        }
      };
    },
    async writeBatch(entries) {
      const db = await acquireDatabase();
      try {
        const transaction = db.transaction('fate', 'readwrite');
        try {
          await Promise.all(
            entries.map(async ([key, value]) =>
              value === undefined
                ? transaction.store.delete(key)
                : transaction.store.put(value, key),
            ),
          );
          await transaction.done;
        } catch (error) {
          try {
            transaction.abort();
          } catch {
            /* Already aborted. */
          }
          await transaction.done.catch(() => {});
          throw error;
        }
      } finally {
        releaseDatabase();
      }
      broadcast([...new Set(entries.map(([key]) => key))]);
    },
  };
}
