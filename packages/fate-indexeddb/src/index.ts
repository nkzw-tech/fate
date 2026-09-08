import type { PersistenceStorage } from '@nkzw/fate/persistence';
import { openDB } from 'idb';

export function indexedDB({ name = 'fate' }: { name?: string } = {}): PersistenceStorage {
  let leases = 0;
  let connection: ReturnType<typeof openDB> | undefined;
  const release = () => {
    if (--leases === 0) {
      const previous = connection;
      connection = undefined;
      void previous?.then(
        (db) => db.close(),
        () => {},
      );
    }
  };
  const database = async () => {
    leases++;
    try {
      return await (connection ??= openDB(name, 1, {
        upgrade(db) {
          db.createObjectStore('fate');
        },
      }));
    } catch (error) {
      release();
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
        leases++;
        try {
          return await run();
        } finally {
          release();
        }
      });
    },
    async read(key) {
      const db = await database();
      try {
        return await db.get('fate', key);
      } finally {
        release();
      }
    },
    async scan(prefix, after, limit = 64) {
      const db = await database();
      try {
        const range = IDBKeyRange.lowerBound(
          after !== undefined && after >= prefix ? after : prefix,
          after !== undefined && after >= prefix,
        );
        const transaction = db.transaction('fate');
        const entries: Array<{ key: string; value: unknown }> = [];
        let cursor = await transaction.store.openCursor(range);
        while (cursor && String(cursor.key).startsWith(prefix) && entries.length < limit) {
          entries.push({ key: String(cursor.key), value: cursor.value });
          cursor = await cursor.continue();
        }
        await transaction.done;
        return entries;
      } finally {
        release();
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
    async write(key, value) {
      const db = await database();
      try {
        const transaction = db.transaction('fate', 'readwrite');
        await transaction.store.put(value, key);
        await transaction.done;
      } finally {
        release();
      }
      broadcast([key]);
    },
    async writeBatch(entries) {
      const db = await database();
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
        release();
      }
      broadcast([...new Set(entries.map(([key]) => key))]);
    },
  };
}
