import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createFateFetchHandler,
  type FateServer,
  type LiveConnectionEventType,
  type LiveEventBus,
  type LiveEventType,
  liveConnectionTopic,
  liveEntityTopic,
  liveGlobalConnectionTopic,
} from '@nkzw/fate/server';
import { defineHandler } from 'void';

type VoidEnv = Record<string, unknown>;
type MaybePromiseLike = PromiseLike<unknown>;

type VoidFatePublishOptions = {
  eventId?: string;
  type?: string;
};

export type VoidFateLiveStream = {
  connect(context: unknown, options?: unknown): Promise<Response>;
  control(context: unknown, options?: unknown): Promise<Response>;
  withEnv(env: unknown): {
    publish(topic: string, data: unknown, options?: VoidFatePublishOptions): Promise<void>;
  };
};

type FateLiveContext = {
  env: VoidEnv;
  pending: Array<Promise<void>>;
  stream: VoidFateLiveStream;
};

type EntityPayload = Readonly<{
  data?: unknown;
  id: string | number;
}>;

type ConnectionPayload = Readonly<{
  cursor?: string;
  id?: string | number;
  node?: unknown;
  nodeType?: string;
  targetCursor?: string;
}>;

export type VoidFateLiveOptions = Record<never, never>;

export type VoidFateRouteOptions = {
  stream: VoidFateLiveStream;
};

export type VoidFateLive = Readonly<{
  live: LiveEventBus;
  withContext: <T>(context: Omit<FateLiveContext, 'pending'>, callback: () => T) => T;
}>;

export const defaultVoidFateRpcPath = '/fate';
export const defaultVoidFateLivePath = '/fate-live';

const isPromiseLike = (value: unknown): value is MaybePromiseLike =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  typeof (value as { then?: unknown }).then === 'function';

export function createVoidFateLive(_options: VoidFateLiveOptions = {}): VoidFateLive {
  const contextStore = new AsyncLocalStorage<FateLiveContext>();

  const publish = (
    topic: string,
    data: EntityPayload | ConnectionPayload,
    options: { eventId?: string; type: LiveConnectionEventType | LiveEventType },
  ) => {
    const context = contextStore.getStore();
    if (!context) {
      return;
    }

    const promise = context.stream
      .withEnv(context.env)
      .publish(topic, data, options)
      .catch(() => undefined);

    context.pending.push(promise);
  };

  const publishEntity = (
    type: string,
    id: string | number,
    options: { data?: unknown; eventId?: string; type?: LiveEventType } = {},
  ) => {
    publish(
      liveEntityTopic(type, id),
      {
        data: options.data,
        id,
      },
      {
        eventId: options.eventId,
        type: options.type ?? 'update',
      },
    );
  };

  const publishConnection = (
    procedure: string,
    args: Record<string, unknown> | undefined,
    type: LiveConnectionEventType,
    options: {
      cursor?: string;
      eventId?: string;
      id?: string | number;
      node?: unknown;
      nodeType?: string;
      targetCursor?: string;
    } = {},
  ) => {
    const topic = args
      ? liveConnectionTopic(procedure, args)
      : liveGlobalConnectionTopic(procedure);

    publish(
      topic,
      {
        cursor: options.cursor,
        id: options.id,
        node: options.node,
        nodeType: options.nodeType,
        targetCursor: options.targetCursor,
      },
      { eventId: options.eventId, type },
    );
  };

  const withContext: VoidFateLive['withContext'] = (context, callback) =>
    contextStore.run({ ...context, pending: [] }, () => {
      const liveContext = contextStore.getStore()!;
      const result = callback();

      if (isPromiseLike(result) || liveContext.pending.length > 0) {
        return Promise.resolve(result).then(async (value) => {
          if (liveContext.pending.length > 0) {
            await Promise.allSettled(liveContext.pending);
          }
          return value;
        }) as ReturnType<typeof callback>;
      }

      return result;
    });

  const live: VoidFateLive = {
    live: {
      connection(procedure, args) {
        return {
          appendEdge(nodeType, id, options) {
            publishConnection(procedure, args, 'appendEdge', { ...options, id, nodeType });
          },
          appendNode(nodeType, id, options) {
            publishConnection(procedure, args, 'appendNode', { ...options, id, nodeType });
          },
          deleteEdge(nodeType, id, options) {
            publishConnection(procedure, args, 'deleteEdge', { ...options, id, nodeType });
          },
          emit(type, options) {
            publishConnection(procedure, args, type, options);
          },
          insertEdgeAfter(nodeType, id, targetCursor, options) {
            publishConnection(procedure, args, 'insertEdgeAfter', {
              ...options,
              id,
              nodeType,
              targetCursor,
            });
          },
          insertEdgeBefore(nodeType, id, targetCursor, options) {
            publishConnection(procedure, args, 'insertEdgeBefore', {
              ...options,
              id,
              nodeType,
              targetCursor,
            });
          },
          invalidate(options) {
            publishConnection(procedure, args, 'invalidate', options);
          },
          prependEdge(nodeType, id, options) {
            publishConnection(procedure, args, 'prependEdge', { ...options, id, nodeType });
          },
          prependNode(nodeType, id, options) {
            publishConnection(procedure, args, 'prependNode', { ...options, id, nodeType });
          },
        };
      },
      delete(type, id, options) {
        publishEntity(type, id, { ...options, type: 'delete' });
      },
      emit: publishEntity,
      subscribe() {
        throw new Error('void-fate: direct live subscriptions are handled by void/live.');
      },
      subscribeConnection() {
        throw new Error('void-fate: direct live subscriptions are handled by void/live.');
      },
      update(type, id, options) {
        publishEntity(type, id, { ...options, type: 'update' });
      },
    },
    withContext,
  };

  return live;
}

export function defineVoidFateRoute<AdapterContext>(
  server: FateServer<unknown, AdapterContext>,
  live: VoidFateLive,
  options: VoidFateRouteOptions,
) {
  const handleFate = createFateFetchHandler(server);
  const handle = (context: { env: VoidEnv; req: { raw: Request } }) =>
    live.withContext({ env: context.env, stream: options.stream }, () =>
      handleFate(context.req.raw, context as AdapterContext),
    );

  return {
    GET: defineHandler(handle),
    POST: defineHandler(handle),
  };
}

export function defineVoidFateLiveRoute(stream: VoidFateLiveStream) {
  return {
    GET: defineHandler((context) => stream.connect(context)),
    POST: defineHandler((context) => stream.control(context)),
  };
}
