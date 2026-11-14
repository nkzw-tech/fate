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
