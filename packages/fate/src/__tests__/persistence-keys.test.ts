import { afterEach, expect, test, vi } from 'vite-plus/test';
import { createClient } from '../client.ts';
import { createPersistence } from '../persistence.ts';
import { clientRoot } from '../root.ts';
import { view } from '../view.ts';
import { memoryStorage } from './persistenceStorage.ts';

afterEach(() => vi.unstubAllGlobals());

test.each([false, true])(
  'compact claims survive restart and migrate legacy keys (%s)',
  async (legacy) => {
    const storage = memoryStorage();
    const prefix = `${JSON.stringify(['keys', 'cache-v2'])}:`;
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `long-entity-id-${index}`,
      title: `Task ${index}`,
    }));
    const selected = view<any>()({ id: true, title: true });
    const request = { items: { ids: rows.map(({ id }) => id), view: selected } };
    let fetches = 0;
    const make = () =>
      createClient({
        persistence: createPersistence({ key: 'keys', storage }),
        roots: { items: clientRoot('Item') },
        transport: {
          fetchById: async () => {
            fetches++;
            return rows;
          },
        },
        types: [{ type: 'Item' }],
      });
    if (legacy) {
      const current = globalThis.crypto;
      vi.stubGlobal('crypto', { randomUUID: () => current.randomUUID() });
    }
    const first = make();
    await first.request(request);
    await first.persistence!.flush();
    first.persistence!.dispose();
    vi.unstubAllGlobals();
    const next = make();
    try {
      await next.request(request);
      expect(fetches).toBe(1);
      expect(next.store.read('Item:long-entity-id-99')?.title).toBe('Task 99');
      await next.persistence!.flush();
      const records = await storage.scan(`${prefix}node:r:`, undefined, 200);
      expect(records).toHaveLength(100);
      for (const { value } of records) {
        const claims = Object.keys((value as any).value.claims);
        expect(claims).toHaveLength(1);
        expect(claims[0]).toMatch(/^sha256:[a-f0-9]{64}$/);
      }
      const roots = await storage.scan(`${prefix}root:`, undefined, 200);
      expect(roots).toHaveLength(1);
      expect(roots[0].key.length).toBeLessThan(120);
      // Changing another request's IDs must create an independent claim.
      await next.request({ items: { ids: rows.slice(0, 99).map(({ id }) => id), view: selected } });
      await next.persistence!.flush();
      expect(await storage.scan(`${prefix}root:`, undefined, 200)).toHaveLength(2);
      await next.persistence!.clearCache();
      expect(await storage.scan(`${prefix}node:`, undefined, 200)).toEqual([]);
    } finally {
      next.persistence!.dispose();
    }
  },
);

test.each([
  { failBatch: 1, headroom: 512, rows: 32 },
  { failBatch: 1, headroom: 1_000_000, rows: 100 },
  { failBatch: 2, headroom: 1_000_000, rows: 100 },
])(
  'legacy cache survives migration with $headroom bytes free and failure at batch $failBatch',
  async ({ failBatch, headroom, rows }) => {
    const storage = memoryStorage();
    const prefix = `${JSON.stringify(['migration', 'cache-v2'])}:`;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const selected = view<any>()({ title: true });
    const ids = Array.from(
      { length: rows },
      (_, index) => `long-item-id-${index.toString().padStart(3, '0')}`,
    );
    const request = { items: { ids, view: selected } };
    const fetchById = vi.fn(async (_type: string, ids: Array<string | number>) =>
      ids.map((id) => ({ id, title: id })),
    );
    const make = (maxBytes?: number) =>
      createClient({
        persistence: createPersistence({
          key: 'migration',
          maxBytes,
          online: () => false,
          storage,
        }),
        roots: { items: clientRoot('Item') },
        transport: { fetchById },
        types: [{ type: 'Item' }],
      });
    const crypto = globalThis.crypto;
    vi.stubGlobal('crypto', { randomUUID: () => crypto.randomUUID() });
    const legacy = make();
    const sessions = [legacy.persistence!];
    const write = storage.writeBatch;
    try {
      await legacy.request(request);
      await legacy.persistence!.flush();
      legacy.persistence!.dispose();
      const [legacyRoot] = await storage.scan(`${prefix}root:`);
      expect(legacyRoot.key).not.toContain('sha256:');
      const maxBytes = Number(await storage.read(`${prefix}bytes`)) + headroom;
      vi.unstubAllGlobals();

      const next = make(maxBytes);
      sessions.push(next.persistence!);
      await next.request(request);
      expect(fetchById).toHaveBeenCalledOnce();
      let batches = 0;
      storage.writeBatch = async (entries) => {
        if (
          entries.some(
            ([key, value]) =>
              value !== undefined &&
              (key.startsWith(`${prefix}root:sha256:`) || key.startsWith(`${prefix}node:`)),
          )
        ) {
          if (++batches === failBatch) {
            throw new Error('Disk busy');
          }
        }
        await write(entries);
      };
      if (headroom === 512) {
        // There is no room for both claims: defer instead of evicting the source.
        await next.persistence!.flush();
        expect(batches).toBe(0);
      } else {
        await expect(next.persistence!.flush()).rejects.toThrow('Disk busy');
        expect(batches).toBe(failBatch);
      }
      expect(await storage.read(legacyRoot.key)).toBeDefined();
      expect(Number(await storage.read(`${prefix}bytes`))).toBeLessThanOrEqual(maxBytes);
      next.persistence!.dispose();
      storage.writeBatch = write;

      fetchById.mockRejectedValue(new TypeError('Offline'));
      const reopened = make(maxBytes);
      sessions.push(reopened.persistence!);
      await reopened.request(request);
      expect(reopened.store.read(`Item:${ids.at(-1)}`)?.title).toBe(ids.at(-1));
      expect(fetchById).toHaveBeenCalledOnce();
      reopened.persistence!.dispose();

      if (headroom === 512) {
        // A later session with sufficient space can finish the deferred migration.
        const retry = make();
        sessions.push(retry.persistence!);
        await retry.request(request);
        await retry.persistence!.flush();
        expect(await storage.read(legacyRoot.key)).toBeUndefined();
        const roots = await storage.scan(`${prefix}root:`);
        expect(roots).toHaveLength(1);
        expect(roots[0].key).toContain('root:sha256:');
        expect(fetchById).toHaveBeenCalledOnce();
      }
    } finally {
      for (const session of sessions) {
        session.dispose();
      }
      storage.writeBatch = write;
      clock.mockRestore();
      vi.unstubAllGlobals();
    }
  },
);
