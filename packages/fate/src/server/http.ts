import type {
  FateLiveControlRequest,
  FateLiveEvent,
  FateLiveMessage,
  FateLiveConnectionEvent,
  FateLiveSubscribeOperation,
  FateLiveConnectionSubscribeOperation,
  FateOperation,
  FateOperationResult,
  FateProtocolRequest,
  FateProtocolResponse,
} from '../protocol.ts';
import { FateRequestError, toProtocolError } from '../protocol.ts';
import { isRecord } from '../record.ts';
import type { AnyRecord } from '../types.ts';
import { resolveConnection, type ConnectionResult } from './connection.ts';
import { isDataView, type DataView, type DataViewResult } from './dataView.ts';
import type { SourceRegistry } from './executor.ts';
import { resolveSourceById, resolveSourceByIds, resolveSourceConnection } from './executor.ts';
import type { LiveConnectionSourceEvent, LiveEventBus, LiveSourceEvent } from './live.ts';
import type { SourceDefinition } from './source.ts';

type MaybePromise<T> = T | Promise<T>;

type SourceResolver<Context> = {
  getSource: <Item extends AnyRecord = AnyRecord>(
    target: DataView<Item> | SourceDefinition<Item, unknown>,
  ) => SourceDefinition<Item, unknown>;
  registry: SourceRegistry<Context>;
};

type RootConfig =
  | DataView<AnyRecord>
  | {
      procedure?: string;
      view: DataView<AnyRecord>;
    };

type RootMap = Record<string, RootConfig>;

type OperationInput = {
  args?: Record<string, unknown>;
  select: Array<string>;
};

type ResolverContext<Context, Input = unknown> = {
  ctx: Context;
  input: Input;
  select: Array<string>;
};

type QueryResolver<Context, Args = Record<string, unknown> | undefined, Output = unknown> = (
  options: ResolverContext<Context, { args?: Args }>,
) => MaybePromise<Output>;

type ListResolver<Context, Args = Record<string, unknown> | undefined, Output = unknown> = (
  options: ResolverContext<Context, { args?: Args }>,
) => MaybePromise<ConnectionResult<Output>>;

type MutationResolver<Context, Input = unknown, Output = unknown> = (
  options: ResolverContext<Context, Input>,
) => MaybePromise<Output>;

type QueryDefinition<Context, Args = Record<string, unknown> | undefined, Output = unknown> = {
  resolve: QueryResolver<Context, Args, Output>;
  type?: string;
};

type ListDefinition<Context, Args = Record<string, unknown> | undefined, Output = unknown> = {
  defaultSize?: number;
  resolve: ListResolver<Context, Args, Output>;
  type?: string;
};

type SchemaLike = {
  '~standard'?: {
    validate: (value: unknown) => unknown;
  };
  parse?: (value: unknown) => unknown;
};

type MutationDefinition<Context, Input = unknown, Output = unknown> = {
  input?: SchemaLike;
  resolve: MutationResolver<Context, Input, Output>;
  type: string;
};

type LiveConfig =
  | LiveEventBus
  | {
      bus: LiveEventBus;
    };

type ContextOptions<AdapterContext> = {
  adapterContext?: AdapterContext;
  request: Request;
};

type LiveServerSubscription = {
  abort: () => void;
};

type LiveConnection<Context> = {
  abort: () => void;
  closed: boolean;
  controller?: ReadableStreamDefaultController<Uint8Array>;
  ctx: Context;
  subscriptions: Map<string, LiveServerSubscription>;
};

type FateServerOptions<
  Context,
  Roots extends RootMap,
  Queries extends Record<string, QueryDefinition<Context, any, any>>,
  Lists extends Record<string, ListDefinition<Context, any, any>>,
  Mutations extends Record<string, MutationDefinition<Context, any, any>>,
  AdapterContext,
> = {
  context?: (options: ContextOptions<AdapterContext>) => MaybePromise<Context>;
  lists?: Lists;
  live?: false | LiveConfig;
  mutations?: Mutations;
  queries?: Queries;
  roots: Roots;
  sources: SourceResolver<Context>;
};

type RootView<Root> =
  Root extends DataView<AnyRecord>
    ? Root
    : Root extends { view: infer View extends DataView<AnyRecord> }
      ? View
      : never;

type RootProcedure<_Root, Name extends string> = Name;

type RootOutput<Root> =
  RootView<Root> extends infer View extends DataView<AnyRecord>
    ? View['kind'] extends 'list'
      ? ConnectionResult<DataViewResult<View>>
      : DataViewResult<View> | null
    : never;

type RootLists<Roots extends RootMap> = {
  [K in keyof Roots as RootView<Roots[K]>['kind'] extends 'list'
    ? RootProcedure<Roots[K], K & string>
    : never]: {
    input: OperationInput;
    output: RootOutput<Roots[K]>;
  };
};

type RootQueries<Roots extends RootMap> = {
  [K in keyof Roots as RootView<Roots[K]>['kind'] extends 'list'
    ? never
    : RootProcedure<Roots[K], K & string>]: {
    input: OperationInput;
    output: RootOutput<Roots[K]>;
  };
};

type QueryAPI<Queries extends Record<string, QueryDefinition<any, any, any>>> = {
  [K in keyof Queries]: Queries[K] extends QueryDefinition<any, infer Args, infer Output>
    ? {
        input: { args?: Args; select: Array<string> };
        output: Awaited<Output>;
      }
    : never;
};

type ListAPI<Lists extends Record<string, ListDefinition<any, any, any>>> = {
  [K in keyof Lists]: Lists[K] extends ListDefinition<any, infer Args, infer Output>
    ? {
        input: { args?: Args; select: Array<string> };
        output: ConnectionResult<Awaited<Output>>;
      }
    : never;
};

type MutationAPI<Mutations extends Record<string, MutationDefinition<any, any, any>>> = {
  [K in keyof Mutations]: Mutations[K] extends MutationDefinition<any, infer Input, infer Output>
    ? {
        entity: Mutations[K]['type'];
        input: Input;
        output: Awaited<Output>;
      }
    : never;
};

export type NativeFateAPI<
  Roots extends RootMap,
  Queries extends Record<string, QueryDefinition<any, any, any>>,
  Lists extends Record<string, ListDefinition<any, any, any>>,
  Mutations extends Record<string, MutationDefinition<any, any, any>>,
> = {
  lists: RootLists<Roots> & ListAPI<Lists>;
  mutations: MutationAPI<Mutations>;
  queries: RootQueries<Roots> & QueryAPI<Queries>;
};

export type FateServer<API, AdapterContext = unknown> = {
  readonly __api?: API;
  handleLiveRequest(request: Request, adapterContext?: AdapterContext): Promise<Response>;
  handleRequest(request: Request, adapterContext?: AdapterContext): Promise<Response>;
  readonly manifest: FateServerManifest;
};

export type InferFateAPI<Server> = Server extends { readonly __api?: infer API } ? API : never;

export type FateServerManifest = Readonly<{
  lists: Record<string, { type: string }>;
  live: Record<string, true>;
  mutations: Record<string, { type: string }>;
  queries: Record<string, { type: string }>;
  types: Record<string, true>;
}>;

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' } as const;
const sseHeaders = {
  'cache-control': 'no-cache',
  connection: 'keep-alive',
  'content-type': 'text/event-stream; charset=utf-8',
} as const;

const normalizeRootConfig = (root: RootConfig): { procedure?: string; view: DataView<AnyRecord> } =>
  isDataView(root) ? { view: root } : root;

const rootProcedureName = (name: string, _root: RootConfig): string => {
  return name;
};

const getLiveBus = (live: false | LiveConfig | undefined): LiveEventBus | null => {
  if (!live) {
    return null;
  }

  if ('subscribe' in live) {
    return live;
  }

  return live.bus;
};

const parseJSON = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    throw new FateRequestError('BAD_REQUEST', 'Request body must be valid JSON.');
  }
};

const validationError = (issues?: unknown) =>
  new FateRequestError('VALIDATION_ERROR', 'Validation failed.', { issues });

const parseInput = async (schema: SchemaLike | undefined, value: unknown): Promise<unknown> => {
  if (!schema) {
    return value;
  }

  const standard = schema['~standard'];
  if (standard) {
    try {
      const result = await standard.validate(value);
      if (isRecord(result) && 'issues' in result) {
        throw validationError(result.issues);
      }

      return isRecord(result) && 'value' in result ? result.value : value;
    } catch (error) {
      if (error instanceof FateRequestError) {
        throw error;
      }

      throw validationError(isRecord(error) ? error.issues : undefined);
    }
  }

  if (schema.parse) {
    try {
      return schema.parse(value);
    } catch (error) {
      throw validationError(isRecord(error) ? error.issues : undefined);
    }
  }

  return value;
};

const isStringArray = (value: unknown): value is Array<string> =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isProtocolId = (value: unknown): value is string | number =>
  typeof value === 'string' || typeof value === 'number';

const operationKinds = new Set(['byId', 'list', 'mutation', 'query']);

const assertProtocolRequest = (value: unknown): FateProtocolRequest => {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.operations)) {
    throw new FateRequestError('BAD_REQUEST', 'Invalid Fate protocol request.');
  }

  for (const operation of value.operations) {
    if (
      !isRecord(operation) ||
      typeof operation.id !== 'string' ||
      typeof operation.kind !== 'string' ||
      !operationKinds.has(operation.kind) ||
      !isStringArray(operation.select) ||
      ('args' in operation && operation.args !== undefined && !isRecord(operation.args))
    ) {
      throw new FateRequestError('BAD_REQUEST', 'Invalid Fate protocol operation.');
    }

    if (
      operation.kind === 'byId' &&
      (typeof operation.type !== 'string' ||
        !Array.isArray(operation.ids) ||
        !operation.ids.every(isProtocolId))
    ) {
      throw new FateRequestError('BAD_REQUEST', 'Invalid Fate byId operation.');
    }

    if (
      (operation.kind === 'list' || operation.kind === 'mutation' || operation.kind === 'query') &&
      typeof operation.name !== 'string'
    ) {
      throw new FateRequestError('BAD_REQUEST', 'Invalid Fate named operation.');
    }
  }

  return value as FateProtocolRequest;
};

const assertLiveControlRequest = (value: unknown): FateLiveControlRequest => {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.connectionId !== 'string' ||
    !Array.isArray(value.operations)
  ) {
    throw new FateRequestError('BAD_REQUEST', 'Invalid Fate live request.');
  }

  for (const operation of value.operations) {
    if (
      !isRecord(operation) ||
      typeof operation.id !== 'string' ||
      typeof operation.kind !== 'string'
    ) {
      throw new FateRequestError('BAD_REQUEST', 'Invalid Fate live operation.');
    }

    if (operation.kind === 'subscribe') {
      if (
        typeof operation.type !== 'string' ||
        !isProtocolId(operation.entityId) ||
        ('args' in operation && operation.args !== undefined && !isRecord(operation.args)) ||
        ('lastEventId' in operation &&
          operation.lastEventId !== undefined &&
          typeof operation.lastEventId !== 'string') ||
        !isStringArray(operation.select)
      ) {
        throw new FateRequestError('BAD_REQUEST', 'Invalid Fate live subscribe operation.');
      }
      continue;
    }

    if (operation.kind === 'subscribeConnection') {
      if (
        typeof operation.type !== 'string' ||
        typeof operation.procedure !== 'string' ||
        ('args' in operation && operation.args !== undefined && !isRecord(operation.args)) ||
        ('selectionArgs' in operation &&
          operation.selectionArgs !== undefined &&
          !isRecord(operation.selectionArgs)) ||
        ('lastEventId' in operation &&
          operation.lastEventId !== undefined &&
          typeof operation.lastEventId !== 'string') ||
        !isStringArray(operation.select)
      ) {
        throw new FateRequestError(
          'BAD_REQUEST',
          'Invalid Fate live connection subscribe operation.',
        );
      }
      continue;
    }

    if (operation.kind !== 'unsubscribe') {
      throw new FateRequestError('BAD_REQUEST', 'Invalid Fate live operation.');
    }
  }

  return value as FateLiveControlRequest;
};

const sse = (message: FateLiveMessage, eventId?: string): string => {
  const lines = [];
  if (eventId) {
    lines.push(`id: ${eventId}`);
  }
  lines.push(`event: ${message.kind}`);
  lines.push(`data: ${JSON.stringify(message)}`);
  return `${lines.join('\n')}\n\n`;
};

const livePayload = (event: LiveSourceEvent, data: unknown): FateLiveEvent =>
  event.type === 'delete' || data == null ? { delete: true, id: event.id } : { data };

const liveConnectionPayload = (
  event: LiveConnectionSourceEvent,
  node: unknown,
): FateLiveConnectionEvent => {
  switch (event.type) {
    case 'deleteEdge':
      return { id: event.id!, nodeType: event.nodeType!, type: 'deleteEdge' };
    case 'invalidate':
      return { type: 'invalidate' };
    default:
      return {
        edge: {
          cursor: event.cursor,
          node,
        },
        nodeType: event.nodeType!,
        targetCursor: event.targetCursor,
        type: event.type,
      };
  }
};

export function createFateServer<
  Context = unknown,
  Roots extends RootMap = RootMap,
  Queries extends Record<string, QueryDefinition<Context, any, any>> = Record<never, never>,
  Lists extends Record<string, ListDefinition<Context, any, any>> = Record<never, never>,
  Mutations extends Record<string, MutationDefinition<Context, any, any>> = Record<never, never>,
  AdapterContext = unknown,
>({
  context,
  lists,
  live,
  mutations,
  queries,
  roots,
  sources,
}: FateServerOptions<Context, Roots, Queries, Lists, Mutations, AdapterContext>): FateServer<
  NativeFateAPI<Roots, Queries, Lists, Mutations>,
  AdapterContext
> {
  const rootLists = new Map<
    string,
    { source: SourceDefinition<AnyRecord>; view: DataView<AnyRecord> }
  >();
  const rootQueries = new Map<
    string,
    { source: SourceDefinition<AnyRecord>; view: DataView<AnyRecord> }
  >();
  const sourcesByType = new Map<string, SourceDefinition<AnyRecord>>();

  const visit = (view: DataView<AnyRecord>) => {
    const source = sources.getSource(view);
    sourcesByType.set(view.typeName, source);

    for (const field of Object.values(view.fields)) {
      if (isDataView(field)) {
        visit(field);
      }
    }
  };

  for (const [name, root] of Object.entries(roots)) {
    const config = normalizeRootConfig(root);
    const procedure = rootProcedureName(name, root);
    const source = sources.getSource(config.view);
    visit(config.view);

    if (config.view.kind === 'list') {
      rootLists.set(procedure, { source, view: config.view });
    } else {
      rootQueries.set(procedure, { source, view: config.view });
    }
  }

  for (const name of rootQueries.keys()) {
    if (!queries?.[name]) {
      throw new Error(
        `Native fate root query '${name}' requires a matching resolver in createFateServer({ queries }).`,
      );
    }
  }

  const liveBus = getLiveBus(live);
  const getContext = async (request: Request, adapterContext?: AdapterContext): Promise<Context> =>
    context ? await context({ adapterContext, request }) : (undefined as Context);

  const executeOperation = async (
    operation: FateOperation,
    ctx: Context,
  ): Promise<FateOperationResult> => {
    try {
      const input = {
        args: operation.args,
        select: operation.select,
      };

      if (operation.kind === 'byId') {
        if (!operation.type || !operation.ids) {
          throw new FateRequestError('BAD_REQUEST', 'byId operations require type and ids.');
        }

        const source = sourcesByType.get(operation.type);
        if (!source) {
          throw new FateRequestError('NOT_FOUND', `No source registered for '${operation.type}'.`);
        }

        return {
          data: await resolveSourceByIds({
            ctx,
            ids: operation.ids.map(String),
            input,
            registry: sources.registry,
            source,
          }),
          id: operation.id,
          ok: true,
        };
      }

      if (!operation.name) {
        throw new FateRequestError('BAD_REQUEST', `${operation.kind} operations require a name.`);
      }

      if (operation.kind === 'list') {
        const customList = lists?.[operation.name];
        if (customList) {
          return {
            data: await customList.resolve({
              ctx,
              input: { args: operation.args },
              select: operation.select,
            }),
            id: operation.id,
            ok: true,
          };
        }

        const root = rootLists.get(operation.name);
        if (!root) {
          throw new FateRequestError('NOT_FOUND', `No list registered for '${operation.name}'.`);
        }

        return {
          data: await resolveConnection({
            ctx,
            input,
            query: ({ ctx, cursor, direction, input, skip, take }) =>
              resolveSourceConnection({
                ctx,
                cursor,
                direction,
                input,
                registry: sources.registry,
                skip,
                source: root.source,
                take,
              }),
          }),
          id: operation.id,
          ok: true,
        };
      }

      if (operation.kind === 'query') {
        const customQuery = queries?.[operation.name];
        if (customQuery) {
          return {
            data: await customQuery.resolve({
              ctx,
              input: { args: operation.args },
              select: operation.select,
            }),
            id: operation.id,
            ok: true,
          };
        }

        throw new FateRequestError('NOT_FOUND', `No query registered for '${operation.name}'.`);
      }

      const mutation = mutations?.[operation.name];
      if (!mutation) {
        throw new FateRequestError('NOT_FOUND', `No mutation registered for '${operation.name}'.`);
      }

      return {
        data: await mutation.resolve({
          ctx,
          input: await parseInput(mutation.input, operation.input),
          select: operation.select,
        }),
        id: operation.id,
        ok: true,
      };
    } catch (error) {
      return {
        error: toProtocolError(error),
        id: operation.id,
        ok: false,
      };
    }
  };

  const manifest: FateServerManifest = {
    lists: Object.fromEntries(
      [
        ...[...rootLists.entries()].map(
          ([name, entry]) => [name, { type: entry.view.typeName }] as const,
        ),
        ...Object.entries(lists ?? {}).map(
          ([name, list]) =>
            [name, { type: list.type ?? rootLists.get(name)?.view.typeName ?? 'Unknown' }] as const,
        ),
      ].sort(([a], [b]) => a.localeCompare(b)),
    ),
    live: liveBus
      ? Object.fromEntries([...sourcesByType.keys()].sort().map((type) => [type, true] as const))
      : {},
    mutations: Object.fromEntries(
      Object.entries(mutations ?? {})
        .map(([name, mutation]) => [name, { type: mutation.type }] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
    queries: Object.fromEntries(
      [
        ...[...rootQueries.entries()].map(
          ([name, entry]) => [name, { type: entry.view.typeName }] as const,
        ),
        ...Object.entries(queries ?? {}).map(
          ([name, query]) =>
            [
              name,
              { type: query.type ?? rootQueries.get(name)?.view.typeName ?? 'Unknown' },
            ] as const,
        ),
      ].sort(([a], [b]) => a.localeCompare(b)),
    ),
    types: Object.fromEntries(
      [...sourcesByType.keys()].sort().map((type) => [type, true] as const),
    ),
  };

  const liveConnections = new Map<string, LiveConnection<Context>>();
  const encoder = new TextEncoder();

  const cleanupLiveConnection = (connectionId: string) => {
    const connection = liveConnections.get(connectionId);
    if (!connection) {
      return;
    }

    connection.closed = true;
    liveConnections.delete(connectionId);
    for (const subscription of connection.subscriptions.values()) {
      subscription.abort();
    }
    connection.subscriptions.clear();
    try {
      connection.controller?.close();
    } catch {
      // The stream may already be closed by the runtime.
    }
    connection.abort();
  };

  const sendLiveMessage = (
    connection: LiveConnection<Context>,
    message: FateLiveMessage,
    eventId?: string,
  ) => {
    if (connection.closed || !connection.controller) {
      return;
    }

    try {
      connection.controller.enqueue(encoder.encode(sse(message, eventId)));
    } catch {
      connection.closed = true;
    }
  };

  const subscribeLiveOperation = (
    connection: LiveConnection<Context>,
    operation: FateLiveSubscribeOperation,
  ) => {
    const source = sourcesByType.get(operation.type);
    if (!source) {
      throw new FateRequestError('NOT_FOUND', `No source registered for '${operation.type}'.`);
    }

    connection.subscriptions.get(operation.id)?.abort();

    const subscriptionController = new AbortController();
    const abort = () => subscriptionController.abort();
    connection.subscriptions.set(operation.id, { abort });

    void (async () => {
      try {
        const iterable = liveBus!.subscribe(operation.type, operation.entityId, {
          lastEventId: operation.lastEventId,
          signal: subscriptionController.signal,
        });

        for await (const [event] of iterable) {
          const data =
            event.type === 'delete'
              ? null
              : await resolveSourceById({
                  ctx: connection.ctx,
                  id: String(event.id),
                  input: {
                    args: operation.args,
                    select: operation.select,
                  },
                  registry: sources.registry,
                  source,
                });

          sendLiveMessage(
            connection,
            {
              event: livePayload(event, data),
              id: operation.id,
              kind: 'next',
            },
            event.eventId,
          );
        }
      } catch (error) {
        if (!subscriptionController.signal.aborted) {
          sendLiveMessage(connection, {
            error: toProtocolError(error),
            id: operation.id,
            kind: 'error',
          });
        }
      } finally {
        if (connection.subscriptions.get(operation.id)?.abort === abort) {
          connection.subscriptions.delete(operation.id);
        }
      }
    })();
  };

  const subscribeLiveConnectionOperation = (
    connection: LiveConnection<Context>,
    operation: FateLiveConnectionSubscribeOperation,
  ) => {
    connection.subscriptions.get(operation.id)?.abort();

    const subscriptionController = new AbortController();
    const abort = () => subscriptionController.abort();
    connection.subscriptions.set(operation.id, { abort });

    void (async () => {
      try {
        const iterable = liveBus!.subscribeConnection(
          { args: operation.args, procedure: operation.procedure },
          {
            lastEventId: operation.lastEventId,
            signal: subscriptionController.signal,
          },
        );

        for await (const [event] of iterable) {
          const nodeType = event.nodeType ?? operation.type;
          const source = nodeType ? sourcesByType.get(nodeType) : null;
          const node =
            event.type === 'deleteEdge' || event.type === 'invalidate'
              ? null
              : event.node !== undefined
                ? event.node
                : event.id != null && source
                  ? await resolveSourceById({
                      ctx: connection.ctx,
                      id: String(event.id),
                      input: {
                        args: operation.selectionArgs,
                        select: operation.select,
                      },
                      registry: sources.registry,
                      source,
                    })
                  : null;

          if (
            event.type !== 'invalidate' &&
            (!nodeType || (event.type !== 'deleteEdge' && node == null))
          ) {
            throw new FateRequestError(
              'NOT_FOUND',
              `No source registered for live connection node type '${nodeType}'.`,
            );
          }

          sendLiveMessage(
            connection,
            {
              event: liveConnectionPayload(event, node),
              id: operation.id,
              kind: 'connection',
            },
            event.eventId,
          );
        }
      } catch (error) {
        if (!subscriptionController.signal.aborted) {
          sendLiveMessage(connection, {
            error: toProtocolError(error),
            id: operation.id,
            kind: 'error',
          });
        }
      } finally {
        if (connection.subscriptions.get(operation.id)?.abort === abort) {
          connection.subscriptions.delete(operation.id);
        }
      }
    })();
  };

  const controlLiveConnection = async (request: Request): Promise<FateProtocolResponse> => {
    const body = assertLiveControlRequest(await parseJSON(request));
    const connection = liveConnections.get(body.connectionId);
    if (!connection || connection.closed) {
      throw new FateRequestError('NOT_FOUND', 'Live connection not found.');
    }

    const results: Array<FateOperationResult> = [];
    for (const operation of body.operations) {
      try {
        if (operation.kind === 'subscribe') {
          subscribeLiveOperation(connection, operation);
        } else if (operation.kind === 'subscribeConnection') {
          subscribeLiveConnectionOperation(connection, operation);
        } else {
          connection.subscriptions.get(operation.id)?.abort();
          connection.subscriptions.delete(operation.id);
        }

        results.push({ data: null, id: operation.id, ok: true });
      } catch (error) {
        results.push({ error: toProtocolError(error), id: operation.id, ok: false });
      }
    }

    return { results, version: 1 };
  };

  const server: FateServer<NativeFateAPI<Roots, Queries, Lists, Mutations>, AdapterContext> = {
    async handleLiveRequest(request, adapterContext) {
      try {
        if (!liveBus) {
          throw new FateRequestError('NOT_FOUND', 'Live views are not enabled.');
        }

        if (request.method === 'POST') {
          return Response.json(await controlLiveConnection(request), { headers: jsonHeaders });
        }

        if (request.method !== 'GET') {
          throw new FateRequestError('BAD_REQUEST', 'Invalid Fate live request.');
        }

        const url = new URL(request.url);
        const connectionId = url.searchParams.get('connectionId');
        if (!connectionId) {
          throw new FateRequestError('BAD_REQUEST', 'Invalid Fate live request.');
        }

        const ctx = await getContext(request, adapterContext);
        const liveController = new AbortController();
        const abortLive = () => liveController.abort();
        if (request.signal.aborted) {
          abortLive();
        } else {
          request.signal.addEventListener('abort', abortLive, { once: true });
        }
        cleanupLiveConnection(connectionId);

        const stream = new ReadableStream<Uint8Array>({
          cancel() {
            cleanupLiveConnection(connectionId);
          },
          start(controller) {
            const connection: LiveConnection<Context> = {
              abort: abortLive,
              closed: false,
              controller,
              ctx,
              subscriptions: new Map(),
            };
            liveConnections.set(connectionId, connection);
            controller.enqueue(encoder.encode(': connected\n\n'));
          },
        });

        liveController.signal.addEventListener(
          'abort',
          () => {
            request.signal.removeEventListener('abort', abortLive);
            cleanupLiveConnection(connectionId);
          },
          { once: true },
        );

        return new Response(stream, { headers: sseHeaders });
      } catch (error) {
        const protocolError = toProtocolError(error);
        return Response.json(
          {
            results: [{ error: protocolError, id: 'live', ok: false }],
            version: 1,
          } satisfies FateProtocolResponse,
          {
            headers: jsonHeaders,
            status: error instanceof FateRequestError ? error.status : 500,
          },
        );
      }
    },
    async handleRequest(request, adapterContext) {
      try {
        const body = assertProtocolRequest(await parseJSON(request));
        const ctx = await getContext(request, adapterContext);
        const results = await Promise.all(
          body.operations.map((operation) => executeOperation(operation, ctx)),
        );

        return Response.json(
          {
            results,
            version: 1,
          } satisfies FateProtocolResponse,
          { headers: jsonHeaders },
        );
      } catch (error) {
        const protocolError = toProtocolError(error);
        return Response.json(
          {
            results: [{ error: protocolError, id: 'request', ok: false }],
            version: 1,
          } satisfies FateProtocolResponse,
          {
            headers: jsonHeaders,
            status: error instanceof FateRequestError ? error.status : 500,
          },
        );
      }
    },
    manifest,
  };

  return server;
}

export function createFateFetchHandler<AdapterContext>(
  server: FateServer<unknown, AdapterContext>,
): (request: Request, adapterContext?: AdapterContext) => Promise<Response> {
  return (request, adapterContext) => {
    const url = new URL(request.url);
    return url.pathname.endsWith('/live')
      ? server.handleLiveRequest(request, adapterContext)
      : server.handleRequest(request, adapterContext);
  };
}

export function createHonoFateHandler<Context>(
  server: FateServer<unknown, Context>,
): (context: Context & { req: { raw: Request } }) => Promise<Response> {
  return (context) => {
    const url = new URL(context.req.raw.url);
    return url.pathname.endsWith('/live')
      ? server.handleLiveRequest(context.req.raw, context)
      : server.handleRequest(context.req.raw, context);
  };
}
