import { isRecord } from './record.ts';
import type { Transport } from './transport.ts';
import type { AnyRecord, Entity, MutationShape, Pagination, TypeConfig } from './types.ts';

type TransportMutations = Record<string, MutationShape>;
type EmptyTransportMutations = Record<never, MutationShape>;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type HeadersFactory = HeadersInit | (() => HeadersInit | Promise<HeadersInit>);

type EventSourceConstructor = new (
  url: string,
  options?: { withCredentials?: boolean },
) => {
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
};

type GraphQLRootConfig = {
  connection?: 'relay';
  field?: string;
  type: string;
};

export type GraphQLMutationDefinition<
  T extends Entity = Entity,
  Input = unknown,
  Output = unknown,
> = Readonly<{
  __fateGraphQLMutation?: {
    input: Input;
    output: Output;
  };
  entity: T['__typename'];
  field: string;
  inputArg?: false | string;
}>;

export type GraphQLMutationInput<Definition> =
  Definition extends GraphQLMutationDefinition<any, infer Input, any> ? Input : never;

export type GraphQLMutationOutput<Definition> =
  Definition extends GraphQLMutationDefinition<any, any, infer Output> ? Output : never;

export type GraphQLMutationMap<Mutations> =
  Mutations extends Record<string, GraphQLMutationDefinition>
    ? {
        [K in keyof Mutations]: {
          input: GraphQLMutationInput<Mutations[K]>;
          output: GraphQLMutationOutput<Mutations[K]>;
        };
      }
    : EmptyTransportMutations;

type GraphQLMutationRuntimeConfig = {
  entity: string;
  field: string;
  inputArg?: false | string;
};

type GraphQLLiveOptions = {
  connectionField?: string;
  entityField?: string;
  url?: string | URL;
  withCredentials?: boolean;
};

export type GraphQLTransportOptions<
  Mutations extends TransportMutations = EmptyTransportMutations,
> = {
  decodeNodeId?: (type: string, id: string | number) => string | number;
  encodeNodeId?: (type: string, id: string | number) => string | number;
  eventSource?: EventSourceConstructor;
  fetch?: FetchLike;
  headers?: HeadersFactory;
  live?: boolean | GraphQLLiveOptions;
  mutateDurably?: Transport<Mutations>['mutateDurably'];
  mutations?: Record<Extract<keyof Mutations, string>, GraphQLMutationRuntimeConfig>;
  roots?: Record<string, GraphQLRootConfig>;
  types: ReadonlyArray<Omit<TypeConfig, 'getId'> & Partial<Pick<TypeConfig, 'getId'>>>;
  url: string | URL;
};

type GraphQLResponse = {
  data?: unknown;
  errors?: Array<GraphQLErrorPayload>;
};

type GraphQLErrorPayload = {
  extensions?: AnyRecord;
  message?: string;
  path?: ReadonlyArray<number | string>;
};

type PendingOperation = {
  alias: string;
  kind: 'mutation' | 'query';
  reject: (error: unknown) => void;
  resolve: (value: unknown) => void;
  selection: string;
  transform: (value: unknown) => unknown;
};

type SelectionTree = Map<string, SelectionTree>;

type GraphQLSSEExecutionResult<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type GraphQLSSESink<T> = {
  complete(): void;
  error(error: unknown): void;
  next(result: T): void;
};

type GraphQLSSEClient = {
  subscribe<T>(
    request: { query: string },
    sink: GraphQLSSESink<GraphQLSSEExecutionResult<Record<string, T>>>,
  ): () => void;
};

type GraphQLSSEModule = {
  createClient(options: {
    credentials: 'include' | 'same-origin';
    fetchFn: FetchLike;
    headers: () => Promise<Record<string, string>>;
    lazy: boolean;
    singleConnection: boolean;
    url: string;
  }): GraphQLSSEClient;
};

type LiveEntityPayload = {
  data?: unknown;
  delete?: boolean;
  id?: string | number;
  select?: Array<string>;
};

type LiveConnectionPayload =
  | {
      cursor?: string;
      node?: unknown;
      nodeType?: string;
      targetCursor?: string;
      type:
        | 'appendEdge'
        | 'appendNode'
        | 'insertEdgeAfter'
        | 'insertEdgeBefore'
        | 'prependEdge'
        | 'prependNode';
    }
  | {
      id?: string | number;
      nodeType?: string;
      type: 'deleteEdge';
    }
  | {
      type: 'invalidate';
    };

const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

const importGraphQLSSE = () => import('graphql-sse') as Promise<GraphQLSSEModule>;

const normalizeEndpoint = (url: string | URL): string => String(url).replace(/\/$/, '');

const resolveHeaders = async (headers: HeadersFactory | undefined): Promise<HeadersInit> =>
  typeof headers === 'function' ? await headers() : (headers ?? {});

const requestHeaders = async (
  defaults: HeadersInit,
  headers: HeadersFactory | undefined,
): Promise<Headers> => {
  const result = new Headers(defaults);
  const custom = new Headers(await resolveHeaders(headers));

  custom.forEach((value, key) => {
    result.set(key, value);
  });

  return result;
};

const headersToRecord = (headers: Headers): Record<string, string> => {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
};

const assertIdentifier = (value: string, context: string): string => {
  if (!/^[_A-Za-z][_0-9A-Za-z]*$/.test(value)) {
    throw new Error(`fate(graphql): Invalid GraphQL ${context} '${value}'.`);
  }
  return value;
};

const defaultEncodeNodeId = (type: string, id: string | number): string | number => `${type}-${id}`;

const defaultDecodeNodeId = (type: string, id: string | number): string | number => {
  if (typeof id !== 'string') {
    return id;
  }

  const prefix = `${type}-`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
};

const errorCodeFromGraphQL = (error: { extensions?: AnyRecord } | undefined) => {
  const code = error?.extensions?.code;
  return typeof code === 'string' ? code : 'INTERNAL_ERROR';
};

const responseError = async (response: Response): Promise<Error> => {
  let message = response.statusText || `HTTP ${response.status}`;
  try {
    const payload = (await response.clone().json()) as GraphQLResponse;
    if (payload.errors?.[0]?.message) {
      message = payload.errors[0].message;
    }
  } catch {
    try {
      const text = await response.text();
      if (text) {
        message = text;
      }
    } catch {
      // Keep the status text fallback.
    }
  }

  return new Error(message);
};

const assertGraphQLResponse = (value: unknown): GraphQLResponse => {
  if (!isRecord(value)) {
    throw new Error('fate(graphql): Invalid GraphQL response.');
  }

  return value as GraphQLResponse;
};

const graphQLLiteral = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }

  const type = typeof value;
  if (type === 'string') {
    return JSON.stringify(value);
  }

  if (type === 'number' || type === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(graphQLLiteral).join(', ')}]`;
  }

  if (isRecord(value)) {
    return `{ ${Object.entries(value)
      .map(([key, entry]) => `${assertIdentifier(key, 'argument')}: ${graphQLLiteral(entry)}`)
      .join(', ')} }`;
  }

  if (value === undefined) {
    return 'null';
  }

  throw new Error(`fate(graphql): Cannot serialize GraphQL argument of type '${type}'.`);
};

const argsToGraphQL = (args?: Record<string, unknown>) => {
  const entries = args ? Object.entries(args).filter(([, value]) => value !== undefined) : [];
  if (entries.length === 0) {
    return '';
  }

  return `(${entries
    .map(([key, value]) => `${assertIdentifier(key, 'argument')}: ${graphQLLiteral(value)}`)
    .join(', ')})`;
};

const getArgsAtPath = (
  args: Record<string, unknown> | undefined,
  path: string,
): Record<string, unknown> | undefined => {
  if (!args) {
    return undefined;
  }

  if (!path) {
    return args;
  }

  let current: unknown = args;
  for (const segment of path.split('.')) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return isRecord(current) ? current : undefined;
};

const getTypeConfig = (types: ReadonlyMap<string, TypeConfig>, type: string): TypeConfig => {
  const config = types.get(type);
  if (!config) {
    throw new Error(`fate(graphql): Unknown entity type '${type}'.`);
  }
  return config;
};

const rootArgsToGraphQL = ({
  args,
  type,
  types,
}: {
  args?: Record<string, unknown>;
  type: string;
  types: ReadonlyMap<string, TypeConfig>;
}) => {
  if (!args) {
    return '';
  }

  const fields = getTypeConfig(types, type).fields ?? {};
  const rootArgs = Object.fromEntries(
    Object.entries(args).filter(([key]) => {
      const descriptor = fields[key];
      return !(
        descriptor &&
        typeof descriptor === 'object' &&
        ('listOf' in descriptor || 'type' in descriptor)
      );
    }),
  );

  return argsToGraphQL(rootArgs);
};

const buildSelectionTree = (select: Iterable<string>): SelectionTree => {
  const root: SelectionTree = new Map();

  for (const path of select) {
    let current = root;
    for (const segment of path.split('.')) {
      if (!segment) {
        continue;
      }

      let next = current.get(segment);
      if (!next) {
        next = new Map();
        current.set(segment, next);
      }
      current = next;
    }
  }

  return root;
};

const buildRecordSelection = ({
  args,
  path,
  select,
  type,
  types,
}: {
  args?: Record<string, unknown>;
  path: string;
  select: Iterable<string>;
  type: string;
  types: ReadonlyMap<string, TypeConfig>;
}): string => {
  const tree = buildSelectionTree(select);

  const walk = (currentType: string, currentTree: SelectionTree, currentPath: string): string => {
    const config = getTypeConfig(types, currentType);
    const fields = new Set([...currentTree.keys(), 'id', '__typename']);
    const lines: Array<string> = [];

    for (const field of [...fields].sort()) {
      if (field === '__typename') {
        lines.push('__typename');
        continue;
      }

      const childTree = currentTree.get(field) ?? new Map();
      const descriptor = config.fields?.[field];
      const fieldPath = currentPath ? `${currentPath}.${field}` : field;
      const fieldName = assertIdentifier(field, 'field');

      if (descriptor && typeof descriptor === 'object' && 'type' in descriptor) {
        lines.push(
          `${fieldName}${argsToGraphQL(getArgsAtPath(args, fieldPath))} { ${walk(
            descriptor.type,
            childTree,
            fieldPath,
          )} }`,
        );
        continue;
      }

      if (descriptor && typeof descriptor === 'object' && 'listOf' in descriptor) {
        lines.push(
          `${fieldName}${argsToGraphQL(getArgsAtPath(args, fieldPath))} { edges { cursor node { ${walk(
            descriptor.listOf,
            childTree,
            fieldPath,
          )} } } pageInfo { endCursor hasNextPage hasPreviousPage startCursor } }`,
        );
        continue;
      }

      lines.push(fieldName);
    }

    return lines.join(' ');
  };

  return walk(type, tree, path);
};

const relayToFateConnection = (value: unknown) => {
  if (!isRecord(value) || !Array.isArray(value.edges)) {
    return value;
  }

  const pageInfo = isRecord(value.pageInfo) ? value.pageInfo : {};

  return {
    items: value.edges.flatMap((edge) =>
      isRecord(edge)
        ? [
            {
              cursor: typeof edge.cursor === 'string' ? edge.cursor : undefined,
              node: edge.node,
            },
          ]
        : [],
    ),
    pagination: {
      hasNext: pageInfo.hasNextPage === true,
      hasPrevious: pageInfo.hasPreviousPage === true,
      nextCursor: typeof pageInfo.endCursor === 'string' ? pageInfo.endCursor : undefined,
      previousCursor: typeof pageInfo.startCursor === 'string' ? pageInfo.startCursor : undefined,
    } satisfies Pagination,
  };
};

const normalizeGraphQLValue = ({
  decodeNodeId,
  type,
  types,
  value,
}: {
  decodeNodeId: (type: string, id: string | number) => string | number;
  type?: string;
  types: ReadonlyMap<string, TypeConfig>;
  value: unknown;
}): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeGraphQLValue({ decodeNodeId, types, value: entry }));
  }

  const connection = relayToFateConnection(value);
  if (connection !== value) {
    const connectionRecord = connection as {
      items: Array<{ cursor: string | undefined; node: unknown }>;
      pagination: Pagination;
    };
    return {
      ...connectionRecord,
      items: connectionRecord.items.map((entry) => ({
        ...entry,
        node: normalizeGraphQLValue({ decodeNodeId, types, value: entry.node }),
      })),
    };
  }

  if (!isRecord(value)) {
    return value;
  }

  const typename = typeof value.__typename === 'string' ? value.__typename : type;
  const config = typename ? types.get(typename) : undefined;
  const result: AnyRecord = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key === 'id' && typename && (typeof entry === 'string' || typeof entry === 'number')) {
      result.id = decodeNodeId(typename, entry);
      continue;
    }

    const descriptor = config?.fields?.[key];
    if (descriptor && typeof descriptor === 'object' && 'type' in descriptor) {
      result[key] = normalizeGraphQLValue({
        decodeNodeId,
        type: descriptor.type,
        types,
        value: entry,
      });
      continue;
    }

    result[key] = normalizeGraphQLValue({ decodeNodeId, types, value: entry });
  }

  return result;
};

const graphQLRequest = async ({
  fetchImpl,
  headers,
  query,
  url,
}: {
  fetchImpl: FetchLike;
  headers: HeadersFactory | undefined;
  query: string;
  url: string;
}) => {
  const response = await fetchImpl(url, {
    body: JSON.stringify({ query }),
    headers: await requestHeaders({ 'content-type': 'application/json' }, headers),
    method: 'POST',
  });

  if (!response.ok) {
    throw await responseError(response);
  }

  const payload = assertGraphQLResponse(await response.json());

  return {
    data: isRecord(payload.data) ? payload.data : {},
    errors: payload.errors ?? [],
  };
};

const graphQLError = (error: GraphQLErrorPayload | undefined): Error => {
  const code = errorCodeFromGraphQL(error);
  return new Error(error?.message ?? `GraphQL ${code}`);
};

const reportExecutionError = (
  result: GraphQLSSEExecutionResult<unknown> | undefined,
  handlers: { onError?: (error: unknown) => void },
) => {
  if (!result?.errors?.length) {
    return false;
  }

  handlers.onError?.(new Error(result.errors[0]?.message ?? 'GraphQL subscription error.'));
  return true;
};

export function graphqlMutation<T extends Entity, Input, Output>(
  entity: T['__typename'],
  options: { field: string; inputArg?: false | string },
): GraphQLMutationDefinition<T, Input, Output> {
  return Object.freeze({
    entity,
    field: options.field,
    inputArg: options.inputArg,
  }) as GraphQLMutationDefinition<T, Input, Output>;
}

export function createGraphQLTransport<
  Mutations extends TransportMutations = EmptyTransportMutations,
>({
  decodeNodeId = defaultDecodeNodeId,
  encodeNodeId = defaultEncodeNodeId,
  fetch: fetchImpl = defaultFetch,
  headers,
  live = true,
  mutateDurably,
  mutations,
  roots,
  types: typeConfigs,
  url,
}: GraphQLTransportOptions<Mutations>): Transport<Mutations> {
  const endpoint = normalizeEndpoint(url);
  const types = new Map(typeConfigs.map((type) => [type.type, type as TypeConfig]));
  let nextId = 0;
  let pending: Array<PendingOperation> = [];
  let scheduled = false;
  let graphQLLiveClient: GraphQLSSEClient | undefined;
  let graphQLSSEModule: Promise<GraphQLSSEModule> | undefined;

  const enqueue = (operation: Omit<PendingOperation, 'alias' | 'reject' | 'resolve'>) =>
    new Promise<unknown>((resolve, reject) => {
      pending.push({
        ...operation,
        alias: `f${++nextId}`,
        reject,
        resolve,
      });

      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });

  const flush = async () => {
    scheduled = false;
    const batch = pending;
    pending = [];

    if (!batch.length) {
      return;
    }

    await Promise.all(
      (['query', 'mutation'] as const).map(async (kind) => {
        const operations = batch.filter((entry) => entry.kind === kind);
        if (operations.length === 0) {
          return;
        }

        try {
          const { data, errors } = await graphQLRequest({
            fetchImpl,
            headers,
            query: `${kind} Fate${kind === 'query' ? 'Query' : 'Mutation'} { ${operations
              .map((entry) => `${entry.alias}: ${entry.selection}`)
              .join(' ')} }`,
            url: endpoint,
          });
          const aliases = new Set(operations.map((operation) => operation.alias));
          const errorsByAlias = new Map<string, Array<GraphQLErrorPayload>>();
          const globalErrors: Array<GraphQLErrorPayload> = [];

          for (const error of errors) {
            const alias = typeof error.path?.[0] === 'string' ? error.path[0] : undefined;
            if (alias && aliases.has(alias)) {
              const aliasErrors = errorsByAlias.get(alias) ?? [];
              aliasErrors.push(error);
              errorsByAlias.set(alias, aliasErrors);
            } else {
              globalErrors.push(error);
            }
          }

          if (globalErrors.length) {
            throw graphQLError(globalErrors[0]);
          }

          for (const operation of operations) {
            const operationErrors = errorsByAlias.get(operation.alias);
            if (operationErrors?.length) {
              operation.reject(graphQLError(operationErrors[0]));
              continue;
            }

            operation.resolve(operation.transform(data[operation.alias]));
          }
        } catch (error) {
          for (const operation of operations) {
            operation.reject(error);
          }
        }
      }),
    );
  };

  const transport: Transport<Mutations> = {
    fetchById(type, ids, select, args) {
      const globalIds = ids.map((id) => encodeNodeId(type, id));
      const selection = buildRecordSelection({ args, path: '', select, type, types });
      return enqueue({
        kind: 'query',
        selection: `nodes(ids: ${graphQLLiteral(globalIds)}) { ... on ${assertIdentifier(
          type,
          'type',
        )} { ${selection} } }`,
        transform: (value) =>
          (Array.isArray(value) ? value : [])
            .filter(Boolean)
            .map((entry) => normalizeGraphQLValue({ decodeNodeId, type, types, value: entry })),
      }) as Promise<Array<unknown>>;
    },
    fetchList(name, select, args) {
      const root = roots?.[name];
      if (!root) {
        throw new Error(`fate(graphql): Missing root list mapping for '${name}'.`);
      }

      const field = assertIdentifier(root.field ?? name, 'field');
      const selection = buildRecordSelection({ args, path: '', select, type: root.type, types });
      const rootArgs = rootArgsToGraphQL({ args, type: root.type, types });
      return enqueue({
        kind: 'query',
        selection: `${field}${rootArgs} { edges { cursor node { ${selection} } } pageInfo { endCursor hasNextPage hasPreviousPage startCursor } }`,
        transform: (value) =>
          normalizeGraphQLValue({
            decodeNodeId,
            type: root.type,
            types,
            value,
          }),
      }) as Promise<{
        items: Array<{ cursor: string | undefined; node: unknown }>;
        pagination: Pagination;
      }>;
    },
    fetchQuery(name, select, args) {
      const root = roots?.[name];
      if (!root) {
        throw new Error(`fate(graphql): Missing root query mapping for '${name}'.`);
      }

      const field = assertIdentifier(root.field ?? name, 'field');
      const selection = buildRecordSelection({ args, path: '', select, type: root.type, types });
      const rootArgs = rootArgsToGraphQL({ args, type: root.type, types });
      return enqueue({
        kind: 'query',
        selection: `${field}${rootArgs} { ${selection} }`,
        transform: (value) =>
          normalizeGraphQLValue({
            decodeNodeId,
            type: root.type,
            types,
            value,
          }),
      });
    },
    mutate(name, input, select) {
      const mutation = mutations?.[name as Extract<keyof Mutations, string>];
      if (!mutation) {
        throw new Error(`fate(graphql): Missing mutation mapping for '${name}'.`);
      }

      const field = assertIdentifier(mutation.field, 'mutation');
      const args =
        mutation.inputArg === false
          ? ((input ?? {}) as Record<string, unknown>)
          : { [mutation.inputArg ?? 'input']: input };
      const selection = buildRecordSelection({
        args: isRecord(input) && isRecord(input.args) ? (input.args as AnyRecord) : undefined,
        path: '',
        select,
        type: mutation.entity,
        types,
      });

      return enqueue({
        kind: 'mutation',
        selection: `${field}${argsToGraphQL(args)} { ${selection} }`,
        transform: (value) =>
          normalizeGraphQLValue({
            decodeNodeId,
            type: mutation.entity,
            types,
            value,
          }),
      }) as Promise<Mutations[Extract<keyof Mutations, string>]['output']>;
    },
    mutateDurably,
  };

  if (live !== false) {
    const liveOptions = typeof live === 'object' ? live : {};
    const liveUrl = liveOptions.url ?? `${endpoint}/stream`;
    const getLiveClient = async () => {
      if (graphQLLiveClient) {
        return graphQLLiveClient;
      }

      let graphQLSSE: GraphQLSSEModule;
      try {
        graphQLSSE = await (graphQLSSEModule ??= importGraphQLSSE());
      } catch (error) {
        throw new Error(
          "fate(graphql): GraphQL live queries require the optional 'graphql-sse' package. Install it or pass live: false.",
          { cause: error },
        );
      }

      const { createClient } = graphQLSSE;
      return (graphQLLiveClient ??= createClient({
        credentials: liveOptions.withCredentials === false ? 'same-origin' : 'include',
        fetchFn: fetchImpl,
        headers: async () => headersToRecord(await requestHeaders({}, headers)),
        lazy: true,
        singleConnection: true,
        url: String(liveUrl),
      }));
    };
    const subscribeLive = <Data>(
      query: string,
      sink: GraphQLSSESink<GraphQLSSEExecutionResult<Record<string, Data>>>,
    ) => {
      let disposed = false;
      let unsubscribe: (() => void) | undefined;
      void getLiveClient()
        .then((client) => {
          if (disposed) {
            return;
          }

          unsubscribe = client.subscribe({ query }, sink);
          if (disposed) {
            unsubscribe();
          }
        })
        .catch((error) => {
          if (!disposed) {
            sink.error(error);
          }
        });

      return () => {
        disposed = true;
        unsubscribe?.();
      };
    };

    transport.subscribeById = (type, id, select, args, handlers) => {
      const field = assertIdentifier(liveOptions.entityField ?? 'fateLiveNode', 'subscription');
      const query = `subscription FateLiveNode { ${field}(type: ${graphQLLiteral(
        type,
      )}, id: ${graphQLLiteral(encodeNodeId(type, id))}, select: ${graphQLLiteral([
        ...select,
      ])}, args: ${graphQLLiteral(args ?? null)}) { data delete id select } }`;
      const sink: GraphQLSSESink<GraphQLSSEExecutionResult<Record<string, LiveEntityPayload>>> = {
        complete() {},
        error: (error) => handlers.onError?.(error),
        next(result) {
          try {
            if (reportExecutionError(result, handlers)) {
              return;
            }

            const value = result.data?.[field];
            if (!isRecord(value)) {
              return;
            }

            const eventPayload = value as LiveEntityPayload;
            if (eventPayload.delete) {
              handlers.onDelete?.(
                eventPayload.id == null ? id : decodeNodeId(type, eventPayload.id),
              );
              return;
            }

            handlers.onData(
              normalizeGraphQLValue({
                decodeNodeId,
                type,
                types,
                value: eventPayload.data,
              }),
              eventPayload.select,
            );
          } catch (error) {
            handlers.onError?.(error);
          }
        },
      };

      return subscribeLive(query, sink);
    };

    transport.subscribeConnection = (procedure, type, args, select, selectionArgs, handlers) => {
      const field = assertIdentifier(
        liveOptions.connectionField ?? 'fateLiveConnection',
        'subscription',
      );
      const query = `subscription FateLiveConnection { ${field}(procedure: ${graphQLLiteral(
        procedure,
      )}, type: ${graphQLLiteral(type)}, args: ${graphQLLiteral(
        args ?? null,
      )}, select: ${graphQLLiteral([...select])}, selectionArgs: ${graphQLLiteral(
        selectionArgs ?? null,
      )}) { cursor id node nodeType targetCursor type } }`;
      const sink: GraphQLSSESink<GraphQLSSEExecutionResult<Record<string, LiveConnectionPayload>>> =
        {
          complete() {},
          error: (error) => handlers.onError?.(error),
          next(result) {
            try {
              if (reportExecutionError(result, handlers)) {
                return;
              }

              const value = result.data?.[field];
              if (!isRecord(value)) {
                return;
              }

              const eventPayload = value as LiveConnectionPayload;
              if (eventPayload.type === 'invalidate') {
                handlers.onEvent({ type: 'invalidate' });
                return;
              }

              if (eventPayload.type === 'deleteEdge') {
                if (eventPayload.id != null) {
                  handlers.onEvent({
                    id: decodeNodeId(eventPayload.nodeType ?? type, eventPayload.id),
                    nodeType: eventPayload.nodeType ?? type,
                    type: 'deleteEdge',
                  });
                }
                return;
              }

              handlers.onEvent({
                edge: {
                  cursor: eventPayload.cursor,
                  node: normalizeGraphQLValue({
                    decodeNodeId,
                    type: eventPayload.nodeType ?? type,
                    types,
                    value: eventPayload.node,
                  }),
                },
                nodeType: eventPayload.nodeType ?? type,
                targetCursor: eventPayload.targetCursor,
                type: eventPayload.type,
              });
            } catch (error) {
              handlers.onError?.(error);
            }
          },
        };

      return subscribeLive(query, sink);
    };
  }

  return transport;
}
