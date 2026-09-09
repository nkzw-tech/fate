import type { FateClient } from './client.ts';
import {
  decodeClientHydrationState,
  decodeHydrationValue,
  encodeHydrationValue,
} from './hydration.ts';
import { getErrorStatusCode, prepareMutation, type MutationCommand } from './mutation.ts';
import { PersistenceCache } from './persistence-cache.ts';
import { deserializePlan, serializePlan } from './persistence-codec.ts';
import {
  PersistenceJournal,
  type ConfirmedJournalEntry,
  type JournalData as Data,
  type JournalEntry,
  type PendingJournalEntry,
} from './persistence-journal.ts';
import type { Persistence, PersistenceRuntime, PersistenceSnapshot } from './persistence-types.ts';
import { persistencePageSize, yieldPersistenceTask } from './persistence-utils.ts';
import { FateRequestError } from './protocol.ts';
import type { RequestDescriptor } from './request-descriptor.ts';
import type { StoreChange } from './store.ts';

export type {
  PersistedMutationStatus,
  Persistence,
  PersistenceSession,
  PersistenceSnapshot,
  RequestPersistenceOptions,
} from './persistence-types.ts';
type Encoded = ReturnType<typeof encodeHydrationValue>;
type PreparedOperation = Omit<ReturnType<typeof prepareMutation>, 'commit' | 'rollback'> & {
  commit(result: unknown, persist?: boolean): void;
  getCacheUpdates(): Encoded | undefined;
  rollback(persist?: boolean): void;
};

const isPendingMutation = (entry: JournalEntry): entry is PendingJournalEntry =>
  entry.status === 'queued' || entry.status === 'sending';

const replaceMutation = (
  data: Data,
  id: string,
  replace: (entry: JournalEntry) => JournalEntry,
) => {
  const index = data.mutations.findIndex((entry) => entry.id === id);
  if (index >= 0) {
    data.mutations[index] = replace(data.mutations[index]);
  }
};

const isTerminalDeliveryError = (status?: number) =>
  status !== undefined && status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status);

const mutationDiscardedError = () => new Error('fate: Mutation was discarded.');

/**
 * Backend-neutral durable storage. Batches apply atomically and resolve only after
 * commit. Exclusive sections must coordinate ALL instances using this key
 * (including other tabs/processes). Use distinct lock names independently.
 */
export type PersistenceStorageEntry = Readonly<{ key: string; value: unknown }>;
export type PersistenceStorageWrite = readonly [key: string, value: unknown];

export interface PersistenceStorage {
  exclusive<T>(key: string, run: () => Promise<T>): Promise<T>;
  read(key: string): Promise<unknown>;
  /** Ordered, bounded scan. Return keys strictly after `after`, under `prefix`. */
  scan(prefix: string, after?: string, limit?: number): Promise<Array<PersistenceStorageEntry>>;
  subscribe?(key: string, listener: () => void): () => void;
  /** Atomically apply a batch. Undefined deletes the key. */
  writeBatch(entries: ReadonlyArray<PersistenceStorageWrite>): Promise<void>;
}

export type PersistenceOptions = Readonly<{
  key: string;
  /** Maximum disk retention since a successful fetch, in milliseconds. Defaults to one day. */
  maxAge?: number;
  /** Encoded storage budget, including the mutation journal. Defaults to 25 MiB. */
  maxBytes?: number;
  /** Override connectivity for native runtimes or controlled offline testing. */
  online?: () => boolean;
  retryDelay?: number;
  storage: PersistenceStorage;
}>;

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
}: PersistenceOptions): Persistence {
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

class Session implements PersistenceRuntime {
  readonly ready: Promise<void>;
  private snapshot: PersistenceSnapshot = { mutations: [], status: 'restoring' };
  private listeners = new Set<() => void>();
  private commands = new Map<
    string,
    { command: MutationCommand; input: unknown; value: Encoded }
  >();
  private operations = new Map<string, PreparedOperation>();
  private mutationAdmission: Promise<unknown> = Promise.resolve();
  private cacheChangeRevision = 0;
  private baseCheckpointRevision = 0;
  private checkpointedCacheUpdates = new Set<string>();
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
  private flushRequested = false;
  private flushing?: Promise<void>;
  private unsubscribe?: () => void;
  private refreshRequested = false;
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
    maxBytes: number,
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

  private clearError() {
    if (!this.mutationError && this.snapshot.error) {
      this.snapshot = { ...this.snapshot, error: undefined };
      this.publish();
    }
  }

  private assertActive() {
    if (this.disposed) {
      throw new Error('fate: Persistence was disposed.');
    }
  }

  private loadJournal = () =>
    this.storage.exclusive(`${this.key}:write`, () => this.journal.load());

  private updateJournal = <T>(apply: (data: Data) => T | Promise<T>, admit = false): Promise<T> =>
    this.storage.exclusive(`${this.key}:write`, async () => {
      this.assertActive();
      const data = await this.journal.load();
      const result = await apply(data);
      const plan = await this.journal.prepare(data);
      const { bytes } = plan;
      if (admit && !(await this.cache.fitsWithoutEviction(bytes))) {
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
      this.assertActive();
      await this.journal.commit(plan);
      return result;
    });

  private async restore() {
    const data = await this.loadJournal();
    await this.cache.initialize();
    if (this.disposed) {
      return;
    }
    for (const entry of data.mutations) {
      if (isPendingMutation(entry)) {
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
      if (++processed % persistencePageSize === 0) {
        await yieldPersistenceTask();
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
              ? decodeHydrationValue(entry.result)
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
    let commitError: unknown;
    let commitFailed = false;
    if (operation.entityId) {
      // Restored operations have no caller promise, but reads must still wait for
      // their optimistic record to be confirmed or rolled back before fetching.
      this.client.registerPendingOptimisticMutation(operation.entityId, promise);
    }
    return {
      ...operation,
      commit: (result: unknown, persist = true) => {
        if (commitFailed) {
          throw commitError;
        }
        try {
          if (persist) {
            cacheUpdates ??= this.cache.captureChanges(() => operation.commit(result));
          } else {
            this.cache.withoutChanges(() => operation.commit(result));
          }
        } catch (error) {
          // Settlement is idempotent, so a second invocation could otherwise
          // appear to succeed after the first local normalization failed.
          commitFailed = true;
          commitError = error;
          throw error;
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
    this.refreshRequested = true;
    return (this.refreshing ??= this.drainRefreshes());
  }

  private async drainRefreshes() {
    try {
      while (this.refreshRequested && !this.disposed) {
        this.refreshRequested = false;
        await this.reconcile(await this.loadJournal());
      }
      this.retry();
    } finally {
      this.refreshing = undefined;
      if (this.refreshRequested && !this.disposed) {
        void this.refresh().catch((error: unknown) => this.report(error));
      }
    }
  }

  async mutate(command: MutationCommand): Promise<unknown> {
    if (this.mutationError) {
      throw this.mutationError;
    }
    // Capture values at invocation, before any asynchronous restoration.
    const encoded = encodeCommand(command);
    await this.ready;
    this.assertActive();
    const id = crypto.randomUUID();
    const admission = this.mutationAdmission.then(async () => {
      if (this.needsCheckpoint) {
        await this.flushCache().catch((error: unknown) => this.report(error));
      }
      return this.updateJournal(async (data) => {
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
    this.assertActive();
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
    this.assertActive();
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

  changed(change?: StoreChange) {
    if (this.disposed) {
      return;
    }
    if (this.cache.changedNode(change)) {
      this.needsCacheRecovery = true;
      this.cacheChangeRevision++;
    }
    if (this.disposed || this.snapshot.status !== 'ready') {
      return;
    }
    if (this.flushing || this.draining) {
      this.flushRequested = true;
    } else {
      this.scheduleSave();
    }
  }

  async flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    await this.ready;
    await this.flushCache();
    this.clearError();
  }

  private scheduleSave() {
    if (!this.saveTimer && !this.disposed) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = undefined;
        void this.flush().catch((error: unknown) => this.report(error));
      }, 25);
    }
  }

  private confirmedCacheEntries(data: Data): Array<readonly [id: string, updates: Encoded]> {
    const scope = this.client.getPersistenceScope();
    return data.mutations.flatMap((entry) =>
      entry.status === 'confirmed' && entry.scope === scope
        ? [[entry.id, entry.cacheUpdates] as const]
        : [],
    );
  }

  private confirmedCacheUpdates(data: Data): Array<Encoded> {
    return this.confirmedCacheEntries(data).map(([, updates]) => updates);
  }

  private async checkpointPendingBases(data: Data) {
    const revision = this.cacheChangeRevision;
    const cacheUpdateIds = this.confirmedCacheEntries(data).map(([id]) => id);
    if (
      revision === this.baseCheckpointRevision &&
      cacheUpdateIds.every((id) => this.checkpointedCacheUpdates.has(id))
    ) {
      return;
    }
    const scope = this.client.getPersistenceScope();
    if (!data.mutations.some((entry) => isPendingMutation(entry) && entry.scope === scope)) {
      this.baseCheckpointRevision = revision;
      for (const id of cacheUpdateIds) {
        this.checkpointedCacheUpdates.add(id);
      }
      return;
    }
    for (const entry of data.mutations) {
      if (isPendingMutation(entry) && entry.scope === scope) {
        entry.base = await this.cache.mutationBase(this.command(entry), entry.base);
      }
    }
    const plan = await this.journal.prepare(data);
    await this.cache.prune(plan.bytes);
    this.assertActive();
    await this.journal.commit(plan);
    this.baseCheckpointRevision = revision;
    for (const id of cacheUpdateIds) {
      this.checkpointedCacheUpdates.add(id);
    }
  }

  private async removeConfirmedEntries(data: Data) {
    const confirmedIds = new Set(
      data.mutations.filter((entry) => entry.status === 'confirmed').map(({ id }) => id),
    );
    if (!confirmedIds.size) {
      return;
    }
    data.mutations = data.mutations.filter(({ id }) => !confirmedIds.has(id));
    await this.journal.commit(await this.journal.prepare(data));
    for (const id of confirmedIds) {
      this.checkpointedCacheUpdates.delete(id);
    }
  }

  private flushCache(): Promise<void> {
    this.assertActive();
    this.flushRequested = true;
    if (!this.flushing) {
      const flushing = this.drainCacheFlushes();
      this.flushing = flushing;
      void flushing.then(
        () => this.finishCacheFlush(flushing),
        () => this.finishCacheFlush(flushing),
      );
    }
    return this.flushing;
  }

  private finishCacheFlush(flushing: Promise<void>) {
    if (this.flushing !== flushing) {
      return;
    }
    this.flushing = undefined;
    if (this.flushRequested && !this.disposed) {
      this.scheduleSave();
    }
  }

  private async drainCacheFlushes() {
    while (this.flushRequested && !this.disposed) {
      this.flushRequested = false;
      await this.flushCacheOnce();
    }
  }

  private async flushCacheOnce() {
    await this.storage.exclusive(`${this.key}:write`, async () => {
      this.assertActive();
      const data = await this.journal.load();
      await this.reconcile(data);
      // Re-read recovery work under the write lock: another tab may have
      // checkpointed it and saved newer data since our last notification.
      this.cache.replayChanges(this.confirmedCacheUpdates(data));
      // Preserve live confirmed changes beneath pending optimism on restart.
      await this.checkpointPendingBases(data);
      await this.cache.flush((await this.journal.prepare(data)).bytes);
      this.assertActive();
      // Incompatible cache scopes were cleared during initialization; their
      // confirmed patches no longer have a saved cache to repair.
      await this.removeConfirmedEntries(data);
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

  private async fail(id: string, error: unknown, status?: number) {
    const failure = error instanceof Error ? error : new Error(String(error));
    status ??= getErrorStatusCode(failure);
    await this.updateJournal((data) => {
      replaceMutation(data, id, (entry) => ({
        attempts: entry.attempts,
        command: entry.command,
        error: { message: failure.message, status },
        id: entry.id,
        scope: entry.scope,
        status: 'failed',
      }));
    });
    await this.reconcile(await this.loadJournal());
  }

  private forgetOperation(id: string) {
    this.operations.delete(id);
    this.waiters.delete(id);
  }

  /** Resolve an operation whose journal entry another client already removed. */
  private async recoverOperation(id: string, operation: PreparedOperation) {
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
        throw error;
      }
      operation.rollback(false);
      this.waiters.get(id)?.reject(mutationDiscardedError());
    }
    this.forgetOperation(id);
  }

  private async recoverRemovedOperations(data: Data): Promise<boolean> {
    const retained = new Set(data.mutations.map(({ id }) => id));
    for (const [id, operation] of this.operations) {
      if (retained.has(id)) {
        continue;
      }
      try {
        await this.recoverOperation(id, operation);
      } catch (error) {
        this.report(error);
        this.scheduleRetry();
        return false;
      }
      if (this.disposed) {
        return false;
      }
    }
    return true;
  }

  private async claim(entry: JournalEntry): Promise<boolean> {
    const data = await this.updateJournal((data) => {
      const current = data.mutations.find((item) => item.id === entry.id);
      if (!current || !isPendingMutation(current)) {
        return;
      }
      replaceMutation(data, entry.id, () => ({
        ...current,
        attempts: current.attempts + 1,
        status: 'sending',
      }));
      return data;
    });
    if (!data) {
      return false;
    }
    await this.reconcile(data);
    return true;
  }

  private async confirm(entry: JournalEntry, operation: PreparedOperation, encodedResult: Encoded) {
    const cacheUpdates = operation.getCacheUpdates();
    if (!cacheUpdates) {
      throw new Error('fate: Mutation confirmation did not capture its cache updates.');
    }
    await this.updateJournal((data) => {
      replaceMutation(data, entry.id, (current): ConfirmedJournalEntry => ({
        attempts: current.attempts,
        cacheUpdates,
        command: current.command,
        id: current.id,
        result: encodedResult,
        scope: current.scope,
        status: 'confirmed',
      }));
    });
    await this.reconcile(await this.loadJournal());
  }

  /** Deliver one claimed entry. False means the queue must pause for a retry. */
  private async deliver(entry: JournalEntry, operation: PreparedOperation): Promise<boolean> {
    let result: unknown;
    try {
      result = await operation.execute({ id: entry.id, scope: this.key });
    } catch (error) {
      if (this.disposed) {
        return false;
      }
      const status = error instanceof Error ? getErrorStatusCode(error) : undefined;
      if (isTerminalDeliveryError(status)) {
        await this.fail(entry.id, error);
        return true;
      }
      await this.queueRetry(entry.id, error, status);
      return false;
    }
    if (this.disposed) {
      return false;
    }

    let encodedResult: Encoded;
    try {
      encodedResult = encodeHydrationValue(result);
      operation.commit(result);
    } catch (error) {
      // A receipt exists, so repeating delivery cannot fix a local codec or
      // normalization failure. Keep the failed entry available for inspection.
      await this.fail(entry.id, error, 500);
      return true;
    }

    try {
      await this.confirm(entry, operation, encodedResult);
      return true;
    } catch (error) {
      if (this.disposed) {
        return false;
      }
      const status = error instanceof Error ? getErrorStatusCode(error) : undefined;
      await this.queueRetry(entry.id, error, status);
      return false;
    }
  }

  private async drain() {
    if (this.draining || this.disposed || !this.online()) {
      return;
    }
    this.draining = true;
    try {
      await this.storage.exclusive(`${this.key}:delivery`, async () => {
        while (!this.disposed && this.online()) {
          const data = await this.loadJournal();
          await this.reconcile(data);
          // Missing local entries may have been checkpointed while this tab was
          // suspended. A receipt-only lookup also distinguishes discarded work.
          if (!(await this.recoverRemovedOperations(data))) {
            return;
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
          const operation = this.operations.get(entry.id);
          if (!operation) {
            throw new Error(`fate: Missing restored mutation operation '${entry.id}'.`);
          }
          const claimed = await this.claim(entry);
          if (this.disposed) {
            return;
          }
          if (!claimed) {
            continue;
          }
          if (!(await this.deliver(entry, operation))) {
            return;
          }
        }
      });
      if ((this.needsCheckpoint || this.flushRequested) && !this.disposed) {
        await this.flush().catch((error: unknown) => this.report(error));
      }
    } finally {
      this.draining = false;
    }
  }

  private async queueRetry(id: string, error: unknown, status?: number) {
    await this.updateJournal((latest) => {
      const item = latest.mutations.find((item) => item.id === id);
      if (item && isPendingMutation(item)) {
        replaceMutation(latest, id, () => ({
          ...item,
          error: {
            message: error instanceof Error ? error.message : String(error),
            status,
          },
          nextAttemptAt:
            Date.now() + Math.min(30_000, this.retryDelay * 2 ** Math.min(item.attempts - 1, 10)),
          status: 'queued',
        }));
      }
    });
    await this.reconcile(await this.loadJournal());
    this.scheduleRetry();
  }

  async discard(id: string) {
    await this.ready;
    const outcome = await this.updateJournal((data) => {
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
        return 'confirmed' as const;
      }
      if (!entry) {
        return 'missing' as const;
      }
      data.mutations = data.mutations.filter((entry) => entry.id !== id);
      return 'discarded' as const;
    });
    if (outcome === 'missing') {
      const operation = this.operations.get(id);
      if (operation) {
        await this.recoverOperation(id, operation);
      }
    } else if (outcome === 'discarded') {
      this.operations.get(id)?.rollback();
      this.waiters.get(id)?.reject(mutationDiscardedError());
      this.forgetOperation(id);
    }
    await this.refresh();
  }

  async clearCache() {
    await this.ready;
    this.assertActive();
    await this.storage.exclusive(`${this.key}:write`, async () => {
      this.assertActive();
      await this.cache.clear();
    });
    this.assertActive();
    await this.cache.initialize();
    this.clearError();
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
