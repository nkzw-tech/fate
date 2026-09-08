import type { PersistenceStorage } from '../persistence.ts';

export function memoryStorage() {
  const values = new Map<string, unknown>();
  const locks = new Map<string, Promise<unknown>>();
  const listeners = new Map<string, Set<() => void>>();
  const storage: PersistenceStorage = {
    exclusive(key, run) {
      const promise = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
      locks.set(key, promise);
      return promise;
    },
    async read(key) {
      return structuredClone(values.get(key));
    },
    async scan(prefix, after, limit = 64) {
      return [...values.keys()]
        .filter((key) => key.startsWith(prefix) && (!after || key > after))
        .sort()
        .slice(0, limit)
        .map((key) => ({ key, value: structuredClone(values.get(key)) }));
    },
    subscribe(key, listener) {
      const set = listeners.get(key) ?? new Set();
      listeners.set(key, set);
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    async write(key, value) {
      values.set(key, structuredClone(value));
      for (const listener of listeners.get(key) ?? []) {
        listener();
      }
    },
    async writeBatch(entries) {
      const copied = structuredClone(entries);
      for (const [key, value] of copied) {
        if (value === undefined) {
          values.delete(key);
        } else {
          values.set(key, value);
        }
      }
      for (const [key] of copied) {
        for (const listener of listeners.get(key) ?? []) {
          listener();
        }
      }
    },
  };
  return storage;
}
