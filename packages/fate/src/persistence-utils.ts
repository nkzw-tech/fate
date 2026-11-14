import type { PersistenceStorage } from './persistence.ts';

export const persistencePageSize = 64;

export async function readPersistenceBatch(
  storage: PersistenceStorage,
  keys: ReadonlyArray<string>,
) {
  const results = storage.readMany
    ? await storage.readMany(keys)
    : (await Promise.allSettled(keys.map(async (key) => storage.read(key)))).map((result) => {
        if (result.status === 'rejected') {
          throw result.reason;
        }
        return result.value;
      });
  if (results.length !== keys.length) {
    throw new Error('fate: Invalid persistence readMany result.');
  }
  return results;
}

const encoder = new TextEncoder();

export const persistenceEntrySize = (key: string, value: unknown): number =>
  encoder.encode(JSON.stringify([key, value])).byteLength;

export const yieldPersistenceTask = (): Promise<void> =>
  new Promise((resolve) => {
    // Posted tasks yield to the browser without nested timers' minimum delay.
    // Keep the timer fallback for server runtimes and partial DOM environments.
    if (typeof window !== 'undefined' && typeof MessageChannel !== 'undefined') {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(null);
    } else {
      setTimeout(resolve, 0);
    }
  });
