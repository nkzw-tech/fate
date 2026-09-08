import type { FateClient } from './client.ts';
import {
  decodeClientHydrationState,
  decodeHydrationValue,
  encodeHydrationValue,
} from './hydration.ts';
import { getErrorStatusCode, prepareMutation, type MutationCommand } from './mutation.ts';
import { PersistenceCache } from './persistence-cache.ts';
import { deserializePlan, serializePlan } from './persistence-codec.ts';
import { PersistenceJournal, type JournalData as Data } from './persistence-journal.ts';
import type { Persistence, PersistenceSession, PersistenceSnapshot } from './persistence-types.ts';
import { FateRequestError } from './protocol.ts';
import type { RequestDescriptor } from './request-descriptor.ts';
import type { List } from './store.ts';

export type { Persistence, PersistenceSession, PersistenceSnapshot } from './persistence-types.ts';
type Encoded = ReturnType<typeof encodeHydrationValue>;

/**
 * Backend-neutral durable storage. Writes replace one value atomically and resolve
 * only after commit. Exclusive sections must coordinate ALL instances using this
 * key (including other tabs/processes). Use distinct lock names independently.
 */
export interface PersistenceStorage {
  exclusive<T>(key: string, run: () => Promise<T>): Promise<T>;
  read(key: string): Promise<unknown>;
  /** Ordered, bounded scan. Return keys strictly after `after`, under `prefix`. */
  scan(
    prefix: string,
    after?: string,
    limit?: number,
  ): Promise<Array<{ key: string; value: unknown }>>;
  subscribe?(key: string, listener: () => void): () => void;
  write(key: string, value: unknown): Promise<void>;
  /** Atomically apply a batch. Undefined deletes the key. */
  writeBatch(entries: ReadonlyArray<readonly [string, unknown]>): Promise<void>;
}

const encodeCommand = (command: MutationCommand) =>
  encodeHydrationValue({
    ...command,
    plan: command.plan ? serializePlan(command.plan) : undefined,
  });

const decodeCommand = (value: Encoded): MutationCommand => {
  const command = decodeHydrationValue(value) as Omit<MutationCommand, 'plan'> & {
    plan?: ReturnType<typeof serializePlan>;
  };
  if (
    !command ||
    typeof command.key !== 'string' ||
    typeof command.entity !== 'string' ||
    !['after', 'before', 'none'].includes(command.insert)
  ) {
    throw new Error('fate: Invalid persisted mutation.');
  }
  return { ...command, plan: command.plan ? deserializePlan(command.plan) : undefined };
};

/**
 * Enables cache persistence and durable delivery through the existing mutation API.
 * Import this entry point only in applications using persistence. Storage keys must
 * isolate authenticated accounts/workspaces and match the server's identity scope.
 */
export function createPersistence({
  key,
  maxAge = 86_400_000,
  maxBytes = 25 * 1024 * 1024,
  online = () => typeof navigator === 'undefined' || navigator.onLine,
  retryDelay = 1000,
  storage,
}: {
  key: string;
  /** Maximum disk retention since a successful fetch, in milliseconds. Defaults to one day. */
  maxAge?: number;
  /** Encoded storage budget, including the mutation journal. Defaults to 25 MiB. */
  maxBytes?: number;
  /** Override connectivity for native runtimes or controlled offline testing. */
  online?: () => boolean;
  retryDelay?: number;
  storage: PersistenceStorage;
}): Persistence {
  if (!key || key.length > 1024) {
    throw new Error('fate: Persistence requires an account-scoped key of 1–1024 characters.');
  }
  if (!Number.isFinite(retryDelay) || retryDelay <= 0) {
    throw new Error('fate: retryDelay must be a positive finite number.');
  }
  if (
    !Number.isSafeInteger(maxAge) ||
    maxAge < 0 ||
    maxAge > Number.MAX_SAFE_INTEGER - Date.now()
  ) {
    throw new Error('fate: Persistence maxAge must be a non-negative finite duration.');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('fate: Persistence maxBytes must be a positive safe integer.');
  }
  return {
    attach: (client) => new Session(client, storage, key, online, retryDelay, maxAge, maxBytes),
  };
}

class Session implements PersistenceSession {
  readonly ready: Promise<void>;
  private snapshot: PersistenceSnapshot = { mutations: [], status: 'restoring' };
  private listeners = new Set<() => void>();
  private commands = new Map<
    string,
    { command: MutationCommand; input: unknown; value: Encoded }
  >();
  private operations = new Map<string, ReturnType<Session['prepareOperation']>>();
  private mutationAdmission: Promise<unknown> = Promise.resolve();
  private needsCacheRecovery = false;
  private needsCheckpoint = false;
  private waiters = new Map<
    string,
    { reject(error: Error): void; resolve(value: unknown): void }
  >();
  private readonly mutationError?: Error;
  private disposed = false;
  private draining = false;
  private timer?: ReturnType<typeof setTimeout>;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private unsubscribe?: () => void;
  private refreshing?: Promise<void>;
  private readonly cache: PersistenceCache;
  private readonly journal: PersistenceJournal;
  private readonly onOnline = () => this.retry();

  constructor(
    private readonly client: FateClient<any, any, any>,
    private readonly storage: PersistenceStorage,
    private readonly key: string,
    private readonly online: () => boolean,
    private readonly retryDelay: number,
    maxAge: number,
    private readonly maxBytes: number,
  ) {
    this.journal = new PersistenceJournal(storage, key, (entry) => {
      decodeCommand(entry.command);
    });
    this.cache = new PersistenceCache(client, storage, key, maxAge, maxBytes);
    try {
      client.validatePersistence();
    } catch (error) {
      this.mutationError = error instanceof Error ? error : new Error(String(error));
      this.snapshot = { ...this.snapshot, error: this.mutationError };
    }
    this.ready = this.restore().catch((error: unknown) => {
      if (!this.disposed) {
        this.snapshot = { ...this.snapshot, status: 'error' };
      }
      throw error;
    });
    void this.ready.catch((error: unknown) => this.report(error));
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private command(entry: Data['mutations'][number]) {
    let cached = this.commands.get(entry.id);
    if (cached?.value !== entry.command) {
      cached = {
        command: decodeCommand(entry.command),
        // Snapshot consumers must not be able to change the queued invocation.
        input: (decodeHydrationValue(entry.command) as { input: unknown }).input,
        value: entry.command,
      };
      this.commands.set(entry.id, cached);
    }
    return cached!.command;
  }

  private publish(data?: Data) {
    if (data) {
      this.snapshot = {
        ...this.snapshot,
        mutations: data.mutations
          .filter((entry) => entry.status !== 'confirmed')
          .map((entry) => ({
            error: entry.error?.message,
            id: entry.id,
            input: this.commands.get(entry.id)!.input,
            name: this.command(entry).key,
            status: entry.status as 'queued' | 'sending' | 'failed',
          })),
      };
    }
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Observers cannot interrupt durable delivery. */
      }
    }
  }

  private report(error: unknown) {
    if (this.disposed) {
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      error: error instanceof Error ? error : new Error(String(error)),
      status: this.snapshot.status === 'restoring' ? 'error' : this.snapshot.status,
    };
    this.publish();
  }

  private load = () => this.storage.exclusive(`${this.key}:write`, () => this.journal.load());

  private update = <T>(apply: (data: Data) => T | Promise<T>, admit = false): Promise<T> =>
    this.storage.exclusive(`${this.key}:write`, async () => {
      if (this.disposed) {
        throw new Error('fate: Persistence was disposed.');
      }
      const data = await this.journal.load();
      const result = await apply(data);
      const bytes = await this.journal.measure(data);
      if (admit && bytes > this.maxBytes) {
        throw new Error(
          'fate: Persistence size limit exceeded; unconfirmed mutations have been preserved.',
        );
      }
      try {
        await this.cache.prune(bytes);
      } catch (error) {
        if (admit) {
          throw error;
        }
        this.report(error);
      }
      if (admit && !(await this.cache.fits(bytes))) {
        throw new Error(
          'fate: Persistence size limit exceeded; unconfirmed mutations have been preserved.',
        );
      }
      if (this.disposed) {
        throw new Error('fate: Persistence was disposed.');
      }
      await this.journal.save(data);
      return result;
    });

  private async restore() {
    const data = await this.load();
    await this.cache.initialize();
    if (this.disposed) {
      return;
    }
    for (const entry of data.mutations) {
      if (entry.status === 'queued' || entry.status === 'sending') {
        if (entry.base && entry.base.scope === this.client.getPersistenceScope()) {
          this.cache.restoreBase(decodeClientHydrationState(entry.base.data));
        }
      }
    }
    this.snapshot = { error: this.mutationError, mutations: [], status: 'ready' };
    await this.reconcile(data);
    if (this.needsCacheRecovery) {
      // Reapply the small confirmed-write journal before serving saved reads.
      // A failed cache repair remains retryable and must not expose stale data.
      try {
        await this.flushCache();
      } catch (error) {
        this.report(error);
      }
    }
    if (this.disposed) {
      return;
    }
    this.unsubscribe = this.storage.subscribe?.(this.key, () => {
      void this.refresh().catch((error: unknown) => this.report(error));
    });
    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('online', this.onOnline);
    }
    this.retry();
  }

  private async reconcile(data: Data) {
    if (this.disposed) {
      return;
    }
    let processed = 0;
    for (const entry of data.mutations) {
      if (++processed % 64 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (this.disposed) {
        return;
      }
      this.command(entry);
      if (entry.status === 'confirmed' || entry.status === 'failed') {
        const operation = this.operations.get(entry.id);
        if (entry.status === 'confirmed') {
          this.needsCheckpoint = true;
          const result =
            operation || this.waiters.has(entry.id)
              ? decodeHydrationValue(entry.result!)
              : undefined;
          operation?.commit(result);
          if (entry.cacheUpdates && entry.scope === this.client.getPersistenceScope()) {
            this.needsCacheRecovery = true;
          }
          this.waiters.get(entry.id)?.resolve(result);
        } else {
          operation?.rollback();
          this.waiters.get(entry.id)?.reject(
            new FateRequestError('BAD_REQUEST', entry.error?.message ?? 'Mutation failed.', {
              status: entry.error?.status ?? 400,
            }),
          );
        }
        this.operations.delete(entry.id);
        this.waiters.delete(entry.id);
      } else if (
        !this.operations.has(entry.id) &&
        entry.scope === this.client.getPersistenceScope()
      ) {
        if (entry.base) {
          this.cache.restoreBase(decodeClientHydrationState(entry.base.data));
        }
        const command = this.command(entry);
        if (this.client.hasMutation(command.key, command.entity)) {
          this.operations.set(entry.id, this.prepareOperation(command));
        }
      }
    }
    const retained = new Set(data.mutations.map(({ id }) => id));
    for (const id of this.commands.keys()) {
      if (!retained.has(id)) {
        this.commands.delete(id);
      }
    }
    this.publish(data);
  }

  private prepareOperation(command: MutationCommand) {
    const operation = prepareMutation(
      this.client,
      command,
      this.client.getTypeConfig(command.entity),
      true,
    );
    const { promise, resolve } = Promise.withResolvers<void>();
    let cacheUpdates: Encoded | undefined;
    if (operation.entityId) {
      // Restored operations have no caller promise, but reads must still wait for
      // their optimistic record to be confirmed or rolled back before fetching.
      this.client.registerPendingOptimisticMutation(operation.entityId, promise);
    }
    return {
      ...operation,
      commit: (result: unknown, persist = true) => {
        if (persist) {
          cacheUpdates ??= this.cache.captureChanges(() => operation.commit(result));
        } else {
          this.cache.withoutChanges(() => operation.commit(result));
        }
        resolve();
      },
      getCacheUpdates: () => cacheUpdates,
      rollback: (persist = true) => {
        try {
          if (persist) {
            operation.rollback();
          } else {
            this.cache.withoutChanges(() => operation.rollback());
          }
        } finally {
          resolve();
        }
      },
    };
  }

  private refresh(): Promise<void> {
    return (this.refreshing ??= this.load()
      .then(async (data) => {
        await this.reconcile(data);
        this.retry();
      })
      .finally(() => {
        this.refreshing = undefined;
      }));
  }

  async mutate(command: MutationCommand): Promise<unknown> {
    if (this.mutationError) {
      throw this.mutationError;
    }
    // Capture values at invocation, before any asynchronous restoration.
    const encoded = encodeCommand(command);
    await this.ready;
    if (this.disposed) {
      throw new Error('fate: Persistence was disposed.');
    }
    const id = crypto.randomUUID();
    const admission = this.mutationAdmission.then(async () => {
      if (this.needsCheckpoint) {
        await this.flushCache().catch((error: unknown) => this.report(error));
      }
      return this.update(async (data) => {
        // Restore earlier commands under the journal lock before preparing this
        // invocation, including work queued by tabs without storage notifications.
        await this.reconcile(data);
        const base = await this.cache.mutationBase(decodeCommand(encoded));
        data.mutations.push({
          attempts: 0,
          base,
          command: encoded,
          id,
          scope: base.scope,
          status: 'queued',
        });
        return base;
      }, true);
    });
    // Failed admission must not prevent the next invocation from being saved.
    this.mutationAdmission = admission.catch(() => {});
    const base = await admission;
    if (this.disposed) {
      throw new Error('fate: Persistence was disposed.');
    }
    this.cache.restoreBase(decodeClientHydrationState(base.data));
    const result = new Promise((resolve, reject) => this.waiters.set(id, { reject, resolve }));
    try {
      if (!this.operations.has(id)) {
        this.operations.set(id, this.prepareOperation(decodeCommand(encoded)));
      }
    } catch (error) {
      await this.fail(id, error);
    }
    void this.refresh().catch((error: unknown) => this.report(error));
    this.retry();
    return result;
  }

  async restoreRequest(request: RequestDescriptor) {
    await this.ready;
    if (this.disposed) {
      throw new Error('fate: Persistence was disposed.');
    }
    try {
      if (this.needsCacheRecovery) {
        await this.flush();
      }
      await this.cache.restore(request);
    } catch (error) {
      if (this.disposed) {
        throw error;
      }
      // Read-cache failures are observable, but must not prevent a network read.
      this.report(error);
    }
  }

  fetched(request: RequestDescriptor, options?: { maxAge: number }) {
    if (this.disposed) {
      return;
    }
    this.cache.fetched(request, options?.maxAge);
    this.changed();
  }

  used(request: RequestDescriptor, options?: { maxAge: number }) {
    if (this.disposed) {
      return;
    }
    this.cache.fetched(request, options?.maxAge, false);
    this.changed();
  }

  changed(kind?: 'record' | 'list', key?: string, paths?: Iterable<string>, previousList?: List) {
    if (this.disposed) {
      return;
    }
    if (this.cache.changedNode(kind, key, paths, previousList)) {
      this.needsCacheRecovery = true;
    }
    if (this.disposed || this.snapshot.status !== 'ready') {
      return;
    }
    if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = undefined;
        void this.flush().catch((error: unknown) => this.report(error));
      }, 25);
    }
  }

  async flush() {
    await this.ready;
    await this.flushCache();
  }

  private async flushCache() {
    if (this.disposed) {
      throw new Error('fate: Persistence was disposed.');
    }
    await this.storage.exclusive(`${this.key}:write`, async () => {
      if (this.disposed) {
        throw new Error('fate: Persistence was disposed.');
      }
      const data = await this.journal.load();
      await this.reconcile(data);
      // Re-read recovery work under the write lock: another tab may have
      // checkpointed it and saved newer data since our last notification.
      this.cache.replayChanges(
        data.mutations.flatMap((entry) =>
          entry.cacheUpdates && entry.scope === this.client.getPersistenceScope()
            ? [entry.cacheUpdates]
            : [],
        ),
      );
      // Preserve live confirmed changes beneath pending optimism on restart.
      if (data.mutations.some((entry) => entry.status === 'queued' || entry.status === 'sending')) {
        for (const entry of data.mutations) {
          if (
            (entry.status === 'queued' || entry.status === 'sending') &&
            entry.scope === this.client.getPersistenceScope()
          ) {
            entry.base = await this.cache.mutationBase(this.command(entry), entry.base);
          }
        }
        await this.cache.prune(await this.journal.measure(data));
        if (this.disposed) {
          throw new Error('fate: Persistence was disposed.');
        }
        await this.journal.save(data);
      }
      await this.cache.flush(await this.journal.measure(data));
      if (this.disposed) {
        throw new Error('fate: Persistence was disposed.');
      }
      // Incompatible cache scopes were cleared during initialization; their
      // confirmed patches no longer have a saved cache to repair.
      const confirmed = data.mutations.filter((entry) => entry.status === 'confirmed');
      if (confirmed.length) {
        const ids = new Set(confirmed.map(({ id }) => id));
        data.mutations = data.mutations.filter(({ id }) => !ids.has(id));
        await this.journal.measure(data);
        await this.journal.save(data);
      }
      this.needsCacheRecovery = this.cache.hasChanges;
      this.needsCheckpoint = false;
    });
  }

  retry() {
    if (this.mutationError || this.disposed || this.snapshot.status !== 'ready' || this.draining) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.drain().catch((error: unknown) => {
        this.report(error);
        this.scheduleRetry();
      });
    }, 0);
  }

  private scheduleRetry(delay = this.retryDelay) {
    if (!this.disposed && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.retry();
      }, delay);
    }
  }

  private async fail(id: string, error: unknown) {
    const failure = error instanceof Error ? error : new Error(String(error));
    await this.update((data) => {
      const entry = data.mutations.find((item) => item.id === id);
      if (entry) {
        entry.status = 'failed';
        delete entry.base;
        entry.error = { message: failure.message, status: getErrorStatusCode(failure) };
      }
    });
    await this.reconcile(await this.load());
  }

  private async drain() {
    if (this.draining || this.disposed || !this.online()) {
      return;
    }
    this.draining = true;
    try {
      await this.storage.exclusive(`${this.key}:delivery`, async () => {
        while (!this.disposed && this.online()) {
          const data = await this.load();
          await this.reconcile(data);
          // Missing local entries may have been checkpointed while this tab was
          // suspended. A receipt-only lookup also distinguishes discarded work.
          const retained = new Set(data.mutations.map(({ id }) => id));
          for (const [id, operation] of this.operations) {
            if (retained.has(id)) {
              continue;
            }
            try {
              const result = await operation.execute({ id, replayOnly: true, scope: this.key });
              if (this.disposed) {
                return;
              }
              operation.commit(result, false);
              this.waiters.get(id)?.resolve(result);
            } catch (error) {
              if (this.disposed) {
                return;
              }
              if (!(error instanceof Error) || getErrorStatusCode(error) !== 404) {
                this.report(error);
                this.scheduleRetry();
                return;
              }
              operation.rollback(false);
              this.waiters.get(id)?.reject(new Error('fate: Mutation was discarded.'));
            }
            this.operations.delete(id);
            this.waiters.delete(id);
          }
          const entry = data.mutations.find(
            (item) => item.status !== 'confirmed' && item.status !== 'failed',
          );
          if (!entry) {
            return;
          }
          if (entry.nextAttemptAt && entry.nextAttemptAt > Date.now()) {
            this.scheduleRetry(entry.nextAttemptAt - Date.now());
            return;
          }
          const command = this.command(entry);
          if (
            entry.scope !== this.client.getPersistenceScope() ||
            !this.client.hasMutation(command.key, command.entity)
          ) {
            await this.fail(
              entry.id,
              new FateRequestError(
                'BAD_REQUEST',
                'Persisted mutation is incompatible with this client. Its input has been preserved.',
              ),
            );
            continue;
          }
          const operation = this.operations.get(entry.id)!;
          const claimed = await this.update((latest) => {
            const item = latest.mutations.find((item) => item.id === entry.id);
            if (!item) {
              return false;
            }
            item.status = 'sending';
            item.attempts += 1;
            return true;
          });
          if (this.disposed) {
            return;
          }
          if (!claimed) {
            continue;
          }
          try {
            const result = await operation.execute({ id: entry.id, scope: this.key });
            if (this.disposed) {
              return;
            }
            const encoded = encodeHydrationValue(result);
            // Commit the receipt and the remaining commands' rollback bases in
            // one journal write. Cache admission must never block confirmation.
            operation.commit(result);
            await this.update(async (latest) => {
              this.cache.replayChanges([operation.getCacheUpdates()!]);
              const item = latest.mutations.find((item) => item.id === entry.id);
              if (item) {
                item.status = 'confirmed';
                delete item.base;
                item.result = encoded;
                item.cacheUpdates = operation.getCacheUpdates();
                item.error = undefined;
              }
              for (const pending of latest.mutations) {
                if (
                  (pending.status === 'queued' || pending.status === 'sending') &&
                  pending.scope === this.client.getPersistenceScope()
                ) {
                  pending.base = await this.cache.mutationBase(
                    decodeCommand(pending.command),
                    pending.base,
                  );
                }
              }
            });
            await this.reconcile(await this.load());
            await this.flush().catch((error: unknown) => this.report(error));
          } catch (error) {
            if (this.disposed) {
              return;
            }
            const status = error instanceof Error ? getErrorStatusCode(error) : undefined;
            if (status && status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status)) {
              await this.fail(entry.id, error);
              continue;
            }
            await this.update((latest) => {
              const item = latest.mutations.find((item) => item.id === entry.id);
              if (item && item.status !== 'confirmed') {
                item.status = 'queued';
                item.nextAttemptAt =
                  Date.now() +
                  Math.min(30_000, this.retryDelay * 2 ** Math.min(item.attempts - 1, 10));
                item.error = {
                  message: error instanceof Error ? error.message : String(error),
                  status,
                };
              }
            });
            await this.reconcile(await this.load());
            this.scheduleRetry();
            return;
          }
        }
      });
    } finally {
      this.draining = false;
    }
  }

  async discard(id: string) {
    await this.ready;
    const discarded = await this.update((data) => {
      const entry = data.mutations.find((entry) => entry.id === id);
      if (
        entry &&
        entry.attempts > 0 &&
        entry.status !== 'failed' &&
        entry.status !== 'confirmed'
      ) {
        throw new Error(
          'fate: An attempted mutation may have committed remotely and cannot be discarded until its outcome is known.',
        );
      }
      if (entry?.status === 'confirmed') {
        return;
      }
      data.mutations = data.mutations.filter((entry) => entry.id !== id);
      return true;
    });
    if (discarded) {
      this.operations.get(id)?.rollback();
      this.operations.delete(id);
      this.waiters.get(id)?.reject(new Error('fate: Mutation was discarded.'));
      this.waiters.delete(id);
    }
    await this.refresh();
  }

  async clearCache() {
    await this.ready;
    await this.storage.exclusive(`${this.key}:write`, () => this.cache.clear());
    await this.cache.initialize();
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.client.disposePersistence();
    this.cache.dispose();
    this.journal.dispose();
    clearTimeout(this.timer);
    clearTimeout(this.saveTimer);
    this.unsubscribe?.();
    if (typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('online', this.onOnline);
    }
    for (const operation of this.operations.values()) {
      operation.rollback();
    }
    this.operations.clear();
    this.commands.clear();
    for (const waiter of this.waiters.values()) {
      waiter.reject(new Error('fate: Persistence was disposed; pending mutations remain stored.'));
    }
    this.waiters.clear();
    this.snapshot = { ...this.snapshot, status: 'disposed' };
    this.publish();
  }
}
