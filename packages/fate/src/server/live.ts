import { EventEmitter, on } from 'node:events';
import { filterConnectionArgs, hashArgs } from '../args.ts';

export type LiveEventType = 'delete' | 'update';

export type LiveConnectionEventType =
  | 'appendEdge'
  | 'appendNode'
  | 'deleteEdge'
  | 'insertEdgeAfter'
  | 'insertEdgeBefore'
  | 'invalidate'
  | 'prependEdge'
  | 'prependNode';

export type LiveSourceEvent = Readonly<{
  eventId?: string;
  id: string | number;
  type: LiveEventType;
}>;

export type LiveConnectionSourceEvent = Readonly<{
  cursor?: string;
  eventId?: string;
  id?: string | number;
  node?: unknown;
  nodeType?: string;
  targetCursor?: string;
  type: LiveConnectionEventType;
}>;

type LiveConnectionTarget = Readonly<{
  args?: Record<string, unknown>;
  procedure: string;
}>;

type LiveConnectionEmitOptions = Readonly<{
  cursor?: string;
  eventId?: string;
  node?: unknown;
  nodeType?: string;
  targetCursor?: string;
}>;

type LiveConnectionHandle = Readonly<{
  appendEdge: (nodeType: string, id: string | number, options?: LiveConnectionEmitOptions) => void;
  appendNode: (nodeType: string, id: string | number, options?: LiveConnectionEmitOptions) => void;
  deleteEdge: (nodeType: string, id: string | number, options?: { eventId?: string }) => void;
  emit: (
    type: LiveConnectionEventType,
    options?: LiveConnectionEmitOptions & { id?: string | number },
  ) => void;
  insertEdgeAfter: (
    nodeType: string,
    id: string | number,
    targetCursor: string,
    options?: LiveConnectionEmitOptions,
  ) => void;
  insertEdgeBefore: (
    nodeType: string,
    id: string | number,
    targetCursor: string,
    options?: LiveConnectionEmitOptions,
  ) => void;
  invalidate: (options?: { eventId?: string }) => void;
  prependEdge: (nodeType: string, id: string | number, options?: LiveConnectionEmitOptions) => void;
  prependNode: (nodeType: string, id: string | number, options?: LiveConnectionEmitOptions) => void;
}>;

export type LiveEventBus = Readonly<{
  connection: (procedure: string, args?: Record<string, unknown>) => LiveConnectionHandle;
  delete: (type: string, id: string | number, options?: { eventId?: string }) => void;
  emit: (
    type: string,
    id: string | number,
    options?: { eventId?: string; type?: LiveEventType },
  ) => void;
  subscribe: (
    type: string,
    id: string | number,
    options?: { lastEventId?: string; signal?: AbortSignal },
  ) => AsyncIterable<readonly [LiveSourceEvent]>;
  subscribeConnection: (
    target: LiveConnectionTarget,
    options?: { lastEventId?: string; signal?: AbortSignal },
  ) => AsyncIterable<readonly [LiveConnectionSourceEvent]>;
  update: (type: string, id: string | number, options?: { eventId?: string }) => void;
}>;

const eventName = (type: string, id: string | number) => `${type}:${String(id)}`;
const globalConnectionEventName = (procedure: string) => `connection:${procedure}:*`;
const connectionEventName = (procedure: string, args?: Record<string, unknown>) =>
  `connection:${procedure}:${hashArgs(filterConnectionArgs(args) ?? {})}`;

const mergeEvents = <T>(
  emitter: EventEmitter,
  names: ReadonlyArray<string>,
  signal?: AbortSignal,
): AsyncIterable<readonly [T]> => ({
  [Symbol.asyncIterator]() {
    const queue: Array<T> = [];
    let pending: ((value: IteratorResult<readonly [T]>) => void) | null = null;
    let done = false;

    const cleanup = () => {
      done = true;
      for (const name of names) {
        emitter.off(name, listener);
      }
      signal?.removeEventListener('abort', onAbort);
      pending?.({ done: true, value: undefined });
      pending = null;
    };

    const listener = (value: T) => {
      if (pending) {
        const resolve = pending;
        pending = null;
        resolve({ done: false, value: [value] as const });
        return;
      }
      queue.push(value);
    };

    const onAbort = () => cleanup();

    for (const name of names) {
      emitter.on(name, listener);
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    return {
      async next() {
        if (queue.length > 0) {
          return { done: false, value: [queue.shift()!] as const };
        }
        if (done || signal?.aborted) {
          cleanup();
          return { done: true, value: undefined };
        }
        return await new Promise<IteratorResult<readonly [T]>>((resolve) => {
          pending = resolve;
        });
      },
      async return() {
        cleanup();
        return { done: true, value: undefined };
      },
    };
  },
});

/**
 * Creates a small in-memory event bus for Fate live view subscriptions.
 *
 * The bus only signals that an entity changed. The native live handler refetches
 * the selected record before sending it to clients.
 */
export function createLiveEventBus(): LiveEventBus {
  const emitter = new EventEmitter();

  const emit: LiveEventBus['emit'] = (type, id, options = {}) => {
    emitter.emit(eventName(type, id), {
      eventId: options.eventId,
      id,
      type: options.type ?? 'update',
    } satisfies LiveSourceEvent);
  };

  return {
    connection(procedure, args) {
      const emitConnection = (
        type: LiveConnectionEventType,
        options: LiveConnectionEmitOptions & { id?: string | number } = {},
      ) => {
        const event = {
          cursor: options.cursor,
          eventId: options.eventId,
          id: options.id,
          node: options.node,
          nodeType: options.nodeType,
          targetCursor: options.targetCursor,
          type,
        } satisfies LiveConnectionSourceEvent;

        if (args) {
          emitter.emit(connectionEventName(procedure, args), event);
        } else {
          emitter.emit(globalConnectionEventName(procedure), event);
        }
      };

      return {
        appendEdge(nodeType, id, options) {
          emitConnection('appendEdge', { ...options, id, nodeType });
        },
        appendNode(nodeType, id, options) {
          emitConnection('appendNode', { ...options, id, nodeType });
        },
        deleteEdge(nodeType, id, options) {
          emitConnection('deleteEdge', { ...options, id, nodeType });
        },
        emit: emitConnection,
        insertEdgeAfter(nodeType, id, targetCursor, options) {
          emitConnection('insertEdgeAfter', { ...options, id, nodeType, targetCursor });
        },
        insertEdgeBefore(nodeType, id, targetCursor, options) {
          emitConnection('insertEdgeBefore', { ...options, id, nodeType, targetCursor });
        },
        invalidate(options) {
          emitConnection('invalidate', options);
        },
        prependEdge(nodeType, id, options) {
          emitConnection('prependEdge', { ...options, id, nodeType });
        },
        prependNode(nodeType, id, options) {
          emitConnection('prependNode', { ...options, id, nodeType });
        },
      };
    },
    delete(type, id, options) {
      emit(type, id, { ...options, type: 'delete' });
    },
    emit,
    subscribe(type, id, options) {
      return on(emitter, eventName(type, id), {
        signal: options?.signal,
      }) as AsyncIterable<readonly [LiveSourceEvent]>;
    },
    subscribeConnection(target, options) {
      return mergeEvents<LiveConnectionSourceEvent>(
        emitter,
        [
          connectionEventName(target.procedure, target.args),
          globalConnectionEventName(target.procedure),
        ],
        options?.signal,
      );
    },
    update(type, id, options) {
      emit(type, id, { ...options, type: 'update' });
    },
  };
}
