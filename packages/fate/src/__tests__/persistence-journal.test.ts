import { expect, test, vi } from 'vite-plus/test';
import { encodeHydrationValue } from '../hydration.ts';
import { PersistenceJournal, type JournalEntry } from '../persistence-journal.ts';
import { memoryStorage } from './persistenceStorage.ts';

const entry = (id: string): JournalEntry => ({
  attempts: 0,
  command: encodeHydrationValue({ input: 'x'.repeat(1000), key: 'edit' }),
  id,
  scope: 'scope',
  status: 'queued',
});
const key = 'account:1';

test('journal updates encode and write only changed entries, preserving order across pages', async () => {
  const storage = memoryStorage();
  const journal = new PersistenceJournal(storage, key);
  const entries = Array.from({ length: 130 }, (_, index) => entry(String(130 - index)));
  await journal.save({ mutations: entries });
  const data = await journal.load();
  data.mutations[65].attempts++;
  const stringify = vi.spyOn(JSON, 'stringify');
  const writeBatch = vi.spyOn(storage, 'writeBatch');
  const bytes = await journal.measure(data);
  expect(stringify.mock.calls.length).toBeLessThan(6);
  stringify.mockRestore();
  await journal.save(data);
  expect(writeBatch).toHaveBeenCalledTimes(1);
  expect(writeBatch.mock.calls[0][0]).toHaveLength(2);
  const scan = vi.spyOn(storage, 'scan');
  const next = new PersistenceJournal(storage, key);
  expect((await next.load()).mutations.map(({ id }) => id)).toEqual(entries.map(({ id }) => id));
  expect(scan).toHaveBeenCalledTimes(3);
  expect(scan.mock.calls.every(([, , limit]) => limit === 64)).toBe(true);
  const values = [
    ...(await storage.scan(`${JSON.stringify([key, 'journal'])}:`, undefined, 200)),
    { key, value: await storage.read(key) },
  ];
  expect(bytes).toBe(
    values.reduce(
      (bytes, { key, value }) =>
        bytes + new TextEncoder().encode(JSON.stringify([key, value])).byteLength,
      0,
    ),
  );
  scan.mockClear();
  await next.load();
  expect(scan).not.toHaveBeenCalled();
});

test('migration is atomic and preserves pending work, failures, and cache recovery receipts', async () => {
  const storage = memoryStorage();
  const entries: Array<JournalEntry> = [
    entry('pending'),
    { ...entry('failed'), status: 'failed' },
    {
      ...entry('confirmed'),
      cacheUpdates: encodeHydrationValue([]),
      result: encodeHydrationValue({ id: '1' }),
      status: 'confirmed',
    },
  ];
  const legacy = { mutations: entries, version: 1 };
  await storage.write(key, legacy);
  const writeBatch = storage.writeBatch;
  storage.writeBatch = async () => {
    throw new Error('Interrupted');
  };
  await expect(new PersistenceJournal(storage, key).load()).rejects.toThrow('Interrupted');
  expect(await storage.read(key)).toEqual(legacy);
  storage.writeBatch = writeBatch;
  const journal = new PersistenceJournal(storage, key);
  expect((await journal.load()).mutations).toEqual(entries);
  expect(await storage.read(key)).toMatchObject({ version: 2 });
  expect((await new PersistenceJournal(storage, key).load()).mutations).toEqual(entries);
});

test('failed journal writes do not change the cached revision or lose pending entries', async () => {
  const storage = memoryStorage();
  const journal = new PersistenceJournal(storage, key);
  await journal.save({ mutations: [entry('pending')] });
  const data = await journal.load();
  data.mutations[0].status = 'confirmed';
  const writeBatch = storage.writeBatch;
  storage.writeBatch = async () => {
    throw new Error('Interrupted');
  };
  await expect(journal.save(data)).rejects.toThrow('Interrupted');
  storage.writeBatch = writeBatch;
  expect((await journal.load()).mutations[0].status).toBe('queued');
  await journal.save(data);
  expect((await new PersistenceJournal(storage, key).load()).mutations[0].status).toBe('confirmed');
});

test('disposal during a large journal write cancels before storage commits', async () => {
  const storage = memoryStorage();
  const journal = new PersistenceJournal(storage, key);
  const saving = journal.save({
    mutations: Array.from({ length: 130 }, (_, index) => entry(String(index))),
  });
  journal.dispose();
  await expect(saving).rejects.toThrow('disposed');
  expect(await storage.read(key)).toBeUndefined();
  expect(await storage.scan(`${JSON.stringify([key, 'journal'])}:`)).toEqual([]);
});

test('migration validates commands before replacing legacy data', async () => {
  const storage = memoryStorage();
  const legacy = { mutations: [entry('invalid')], version: 1 };
  await storage.write(key, legacy);
  const journal = new PersistenceJournal(storage, key, () => {
    throw new Error('Invalid command');
  });
  await expect(journal.load()).rejects.toThrow('Invalid command');
  expect(await storage.read(key)).toEqual(legacy);
});
