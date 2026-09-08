import type { FateClient } from './client.ts';
import type { MutationCommand } from './mutation.ts';
import type { RequestDescriptor } from './request-descriptor.ts';
import type { List } from './store.ts';

/** Identity of one logical mutation, reused across every delivery attempt. */
export type MutationIdentity = Readonly<{
  id: string;
  replayOnly?: true;
  /** Return an existing receipt; never execute a new mutation. */ scope: string;
}>;

/** A persistence integration. Implementations are imported separately from Fate core. */
export interface Persistence {
  attach(client: FateClient<any, any, any>): PersistenceSession;
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

/** Observability and lifecycle of an attached persistence integration. */
export interface PersistenceSession {
  /** @internal */
  changed(
    kind?: 'record' | 'list',
    key?: string,
    paths?: Iterable<string>,
    previousList?: List,
  ): void;
  clearCache(): Promise<void>;
  discard(id: string): Promise<void>;
  dispose(): void;
  /** @internal */
  fetched(request: RequestDescriptor, options?: RequestPersistenceOptions): void;
  flush(): Promise<void>;
  getSnapshot(): PersistenceSnapshot;
  /** @internal */
  mutate(command: MutationCommand): Promise<unknown>;
  readonly ready: Promise<void>;
  /** @internal */
  restoreRequest(request: RequestDescriptor): Promise<void>;
  retry(): void;
  subscribe(listener: () => void): () => void;
  /** @internal */
  used(request: RequestDescriptor, options?: RequestPersistenceOptions): void;
}
