import type { FateClient } from './client.ts';
import type { MutationCommand } from './mutation.ts';
import type { RequestDescriptor } from './request-descriptor.ts';
import type { StoreChange } from './store.ts';

/** Identity of one logical mutation, reused across every delivery attempt. */
export type MutationIdentity = Readonly<{
  id: string;
  /** Return an existing receipt; never execute a new mutation. */
  replayOnly?: true;
  scope: string;
}>;

/** A persistence integration. Implementations are imported separately from Fate core. */
export interface Persistence {
  /** @internal */
  attach(client: FateClient<any, any, any>): PersistenceRuntime;
}

export type PersistedMutationStatus = Readonly<{
  error?: string;
  id: string;
  input: unknown;
  name: string;
  status: 'queued' | 'sending' | 'failed';
}>;

export type PersistenceSnapshot = Readonly<{
  error?: Error;
  mutations: ReadonlyArray<PersistedMutationStatus>;
  status: 'restoring' | 'ready' | 'error' | 'disposed';
}>;

export type RequestPersistenceOptions = Readonly<{ maxAge: number }>;

/** User-facing observability and lifecycle of an attached persistence integration. */
export interface PersistenceSession {
  clearCache(): Promise<void>;
  discard(id: string): Promise<void>;
  dispose(): void;
  flush(): Promise<void>;
  getSnapshot(): PersistenceSnapshot;
  readonly ready: Promise<void>;
  retry(): void;
  subscribe(listener: () => void): () => void;
}

/** Contract used internally by Fate to drive an attached persistence session. @internal */
export interface PersistenceRuntime extends PersistenceSession {
  changed(change?: StoreChange): void;
  fetched(request: RequestDescriptor, options?: RequestPersistenceOptions): void;
  mutate(command: MutationCommand): Promise<unknown>;
  restoreRequest(request: RequestDescriptor): Promise<void>;
  /** @internal */
  used(request: RequestDescriptor, options?: RequestPersistenceOptions): void;
}
