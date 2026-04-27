import { EventEmitter, on } from 'node:events';

export type LiveEventType = 'delete' | 'update';

export type LiveSourceEvent = Readonly<{
  eventId?: string;
  id: string | number;
  type: LiveEventType;
}>;

export type LiveEventBus = Readonly<{
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
  update: (type: string, id: string | number, options?: { eventId?: string }) => void;
}>;

const eventName = (type: string, id: string | number) => `${type}:${String(id)}`;

/**
 * Creates a small in-memory event bus for Fate live view subscriptions.
 *
 * The bus only signals that an entity changed. Live tRPC procedures refetch the
 * selected record before sending it to clients.
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
    delete(type, id, options) {
      emit(type, id, { ...options, type: 'delete' });
    },
    emit,
    subscribe(type, id, options) {
      return on(emitter, eventName(type, id), {
        signal: options?.signal,
      }) as AsyncIterable<readonly [LiveSourceEvent]>;
    },
    update(type, id, options) {
      emit(type, id, { ...options, type: 'update' });
    },
  };
}
