export const persistencePageSize = 64;

const encoder = new TextEncoder();

export const persistenceEntrySize = (key: string, value: unknown): number =>
  encoder.encode(JSON.stringify([key, value])).byteLength;

export const yieldPersistenceTask = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));
