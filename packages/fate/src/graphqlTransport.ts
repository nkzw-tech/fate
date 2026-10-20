import { withAliasSupport } from './alias-transport.ts';
import { responseField, schemaField } from './alias.ts';
import { GraphQLRequestError, type GraphQLErrorPayload } from './graphql-error.ts';
import {
  graphQLOutputRelations,
  validateGraphQLArguments,
  validateGraphQLRefetchMappings,
  validateGraphQLQueryRefetch,
  type GraphQLArgumentSchema,
  type GraphQLByIdConfig,
} from './graphqlSchema.ts';
import { isRecord } from './record.ts';
import { encodeRefetchArgs, getRefetchFields } from './refetch.ts';
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
  embedded?: boolean;
  field?: string;
  type: string;
};

export type GraphQLValueRootDefinition<Output = unknown, Input = unknown> = GraphQLRootConfig & {
  readonly __fateGraphQLRoot?: { input: Input; output: Output };
  embedded: true;
};

export type GraphQLRootInput<Definition> =
  Definition extends GraphQLValueRootDefinition<infer _Output, infer Input> ? Input : never;
export type GraphQLRootOutput<Definition> =
  Definition extends GraphQLValueRootDefinition<infer Output, infer _Input> ? Output : never;

export function graphqlValueRoot<Output, Input = Record<string, never>>(options: {
  field?: string;
  type: string;
}): GraphQLValueRootDefinition<Output, Input> {
  return Object.freeze({ ...options, embedded: true }) as GraphQLValueRootDefinition<Output, Input>;
}

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
  type?: string;
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
  type?: string;
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
  byId?: Readonly<Record<string, GraphQLByIdConfig>>;
  decodeNodeId?: (type: string, id: string | number) => string | number;
  encodeNodeId?: (type: string, id: string | number) => string | number;
  eventSource?: EventSourceConstructor;
  fetch?: FetchLike;
  headers?: HeadersFactory;
  live?: boolean | GraphQLLiveOptions;
  mutateDurably?: Transport<Mutations>['mutateDurably'];
  mutations?: Record<Extract<keyof Mutations, string>, GraphQLMutationRuntimeConfig>;
  nodes?: boolean;
  roots?: Record<string, GraphQLRootConfig>;
  schema?: GraphQLArgumentSchema;
  types: ReadonlyArray<Omit<TypeConfig, 'getId'> & Partial<Pick<TypeConfig, 'getId'>>>;
  url: string | URL;
};

type GraphQLResponse = {
  data?: unknown;
  errors?: Array<GraphQLErrorPayload>;
};

type PendingOperation = {
  alias: string;
  kind: 'mutation' | 'query';
  reject: (error: unknown) => void;
  resolve: (value: unknown) => void;
  selection: string;
  transform: (value: unknown) => unknown;
  variables?: Record<string, { type: string; value: unknown }>;
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

const importGraphQLSSE = async (): Promise<GraphQLSSEModule> => {
  try {
    return (await import('graphql-sse')) as GraphQLSSEModule;
  } catch (error) {
    throw new Error(
      "fate(graphql): GraphQL live queries require the optional 'graphql-sse' package. Install it or pass live: false.",
      { cause: error },
    );
  }
};

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

const responseError = async (response: Response): Promise<Error> => {
  let message = response.statusText || `HTTP ${response.status}`;
  try {
    const payload = assertGraphQLResponse(await response.clone().json());
    return new GraphQLRequestError(payload.errors ?? [], {
      data: payload.data,
      message,
      status: response.status,
    });
  } catch {
    try {
      message = (await response.text()) || message;
    } catch {
      // Keep the HTTP status fallback when the response body cannot be read.
    }
  }
  return new GraphQLRequestError([], { message, status: response.status });
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
  argumentsForField,
  field,
  schema,
  type,
  types,
}: {
  args?: Record<string, unknown>;
  argumentsForField: ArgumentsForField;
  field: string;
  schema?: GraphQLArgumentSchema;
  type: string;
  types: ReadonlyMap<string, TypeConfig>;
}) => {
  if (schema) {
    return argumentsForField(schema.queryType, field, args, type);
  }
  if (type === '__value__' || ['Boolean', 'Int', 'Float', 'String', 'ID'].includes(type)) {
    return argumentsForField('Query', field, args);
  }
  const fields = getTypeConfig(types, type).fields ?? {};
  const rootArgs = Object.fromEntries(
    Object.entries(args ?? {}).filter(([key]) => {
      const descriptor = fields[schemaField(key)];
      return !(
        descriptor &&
        typeof descriptor === 'object' &&
        ('listOf' in descriptor || 'type' in descriptor || 'embedded' in descriptor)
      );
    }),
  );

  return argumentsForField('Query', field, rootArgs);
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

type ArgumentsForField = (
  type: string,
  field: string,
  args?: Record<string, unknown>,
  resultType?: string,
) => string;

const buildRecordSelection = ({
  args,
  argumentsForField,
  embedded,
  path,
  select,
  type,
  types,
}: {
  args?: Record<string, unknown>;
  argumentsForField: ArgumentsForField;
  embedded?: boolean;
  path: string;
  select: Iterable<string>;
  type: string;
  types: ReadonlyMap<string, TypeConfig>;
}): string => {
  const tree = buildSelectionTree(select);

  const walk = (
    currentType: string,
    currentTree: SelectionTree,
    currentPath: string,
    embedded = false,
  ): string => {
    const config = getTypeConfig(types, currentType);
    const fields = new Set([
      ...currentTree.keys(),
      ...(embedded ? [] : ['id', '__typename']),
      ...getRefetchFields(config.refetch),
    ]);
    const lines: Array<string> = [];

    for (const field of [...fields].sort()) {
      if (field === '__typename') {
        lines.push('__typename');
        continue;
      }

      const childTree = currentTree.get(field) ?? new Map();
      const sourceField = schemaField(field);
      const descriptor = config.fields?.[sourceField];
      const fieldPath = currentPath ? `${currentPath}.${field}` : field;
      const fieldName = field.includes(':')
        ? `${assertIdentifier(responseField(field), 'alias')}: ${assertIdentifier(sourceField, 'field')}`
        : assertIdentifier(field, 'field');
      const resultType =
        descriptor && typeof descriptor === 'object'
          ? 'type' in descriptor
            ? descriptor.type
            : 'embedded' in descriptor
              ? descriptor.embedded
              : descriptor.listOf
          : undefined;
      const fieldArguments = argumentsForField(
        currentType,
        sourceField,
        getArgsAtPath(args, fieldPath),
        resultType,
      );

      if (descriptor && typeof descriptor === 'object' && 'type' in descriptor) {
        lines.push(
          `${fieldName}${fieldArguments} { ${walk(descriptor.type, childTree, fieldPath)} }`,
        );
        continue;
      }

      if (descriptor && typeof descriptor === 'object' && 'embedded' in descriptor) {
        lines.push(
          `${fieldName}${fieldArguments} { ${walk(descriptor.embedded, childTree, fieldPath, true)} }`,
        );
        continue;
      }

      if (descriptor && typeof descriptor === 'object' && 'listOf' in descriptor) {
        if (descriptor.array) {
          lines.push(
            `${fieldName}${fieldArguments} { ${walk(descriptor.listOf, childTree, fieldPath)} }`,
          );
          continue;
        }
        lines.push(
          `${fieldName}${fieldArguments} { edges { cursor node { ${walk(
            descriptor.listOf,
            childTree,
            fieldPath,
          )} } } pageInfo { endCursor hasNextPage hasPreviousPage startCursor } }`,
        );
        continue;
      }

      lines.push(`${fieldName}${fieldArguments}`);
    }

    for (const concrete of config.possibleTypes ?? []) {
      const fields = [...getRefetchFields(types.get(concrete)?.refetch)].filter(
        (field) => !currentTree.has(field),
      );
      if (fields.length) {
        lines.push(
          `... on ${assertIdentifier(concrete, 'type')} { ${fields.map((field) => `${field}${argumentsForField(concrete, field)}`).join(' ')} }`,
        );
      }
    }
    return lines.join(' ');
  };

  return walk(type, tree, path, embedded);
};

const relayToFateConnection = (value: unknown) => {
  if (!isRecord(value) || (value.edges !== null && !Array.isArray(value.edges))) {
    return value;
  }

  const pageInfo = isRecord(value.pageInfo) ? value.pageInfo : {};
  const edges = Array.isArray(value.edges) ? value.edges : [];

  return {
    items: edges.flatMap((edge) =>
      isRecord(edge) && edge.node != null
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
  selection,
  type,
  types,
  value,
}: {
  decodeNodeId: (type: string, id: string | number) => string | number;
  selection?: SelectionTree;
  type?: string;
  types: ReadonlyMap<string, TypeConfig>;
  value: unknown;
}): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      normalizeGraphQLValue({ decodeNodeId, selection, type, types, value: entry }),
    );
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
        node: normalizeGraphQLValue({ decodeNodeId, selection, type, types, value: entry.node }),
      })),
    };
  }

  if (!isRecord(value)) {
    return value;
  }

  const typename = typeof value.__typename === 'string' ? value.__typename : type;
  const config = typename ? types.get(typename) : undefined;
  const result: AnyRecord = {};

  for (const [responseKey, entry] of Object.entries(value)) {
    const key =
      [...(selection?.keys() ?? [])].find((field) => responseField(field) === responseKey) ??
      responseKey;
    const childSelection = selection?.get(key);
    if (
      schemaField(key) === 'id' &&
      typename &&
      (typeof entry === 'string' || typeof entry === 'number')
    ) {
      result[key] = decodeNodeId(typename, entry);
      continue;
    }

    const descriptor = config?.fields?.[schemaField(key)];
    if (
      descriptor &&
      typeof descriptor === 'object' &&
      ('type' in descriptor || 'embedded' in descriptor)
    ) {
      result[key] = normalizeGraphQLValue({
        decodeNodeId,
        selection: childSelection,
        type: 'type' in descriptor ? descriptor.type : descriptor.embedded,
        types,
        value: entry,
      });
      continue;
    }

    result[key] = normalizeGraphQLValue({
      decodeNodeId,
      selection: childSelection,
      types,
      value: entry,
    });
  }

  return result;
};

const graphQLRequest = async ({
  fetchImpl,
  headers,
  query,
  url,
  variables,
}: {
  fetchImpl: FetchLike;
  headers: HeadersFactory | undefined;
  query: string;
  url: string;
  variables?: Record<string, unknown>;
}) => {
  const response = await fetchImpl(url, {
    body: JSON.stringify({ query, variables }),
    headers: await requestHeaders({ 'content-type': 'application/json' }, headers),
    method: 'POST',
  });

  if (!response.ok) {
    throw await responseError(response);
  }

  const payload = assertGraphQLResponse(await response.json());

  return {
    data: payload.data,
    errors: payload.errors ?? [],
    status: response.status,
  };
};

const reportExecutionError = (
  result: GraphQLSSEExecutionResult<unknown> | undefined,
  handlers: { onError?: (error: unknown) => void },
) => {
  if (!result?.errors?.length) {
    return false;
  }

  handlers.onError?.(new GraphQLRequestError(result.errors));
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

export function graphqlValueMutation<Input, Output>(options: {
  field: string;
  inputArg?: false | string;
  type?: string;
}): GraphQLMutationDefinition<{ __typename: '__value__' }, Input, Output> {
  return Object.freeze({ entity: '__value__', ...options }) as GraphQLMutationDefinition<
    { __typename: '__value__' },
    Input,
    Output
  >;
}

export function createGraphQLTransport<
  Mutations extends TransportMutations = EmptyTransportMutations,
>({
  byId,
  decodeNodeId = defaultDecodeNodeId,
  encodeNodeId = defaultEncodeNodeId,
  fetch: fetchImpl = defaultFetch,
  headers,
  live = true,
  mutateDurably,
  mutations,
  nodes = true,
  roots,
  schema,
  types: typeConfigs,
  url,
}: GraphQLTransportOptions<Mutations>): Transport<Mutations> {
  validateGraphQLRefetchMappings(byId, schema);
  const endpoint = normalizeEndpoint(url);
  const types = new Map<string, TypeConfig>(
    graphQLOutputRelations(schema).map((type) => [
      type.type,
      { ...type, getId: (record: unknown) => (record as { id: string }).id },
    ]),
  );
  for (const config of typeConfigs) {
    const inferred = types.get(config.type);
    types.set(config.type, {
      ...inferred,
      ...config,
      fields: { ...inferred?.fields, ...config.fields },
    } as TypeConfig);
  }
  for (const config of types.values()) {
    if (config.refetch) {
      validateGraphQLQueryRefetch(config.type, config.refetch, roots, schema);
    }
  }
  let nextId = 0;
  let nextVariableId = 0;
  const operationArguments = () => {
    const variables: NonNullable<PendingOperation['variables']> = {};
    const argumentsForField: ArgumentsForField = (type, field, args, resultType) => {
      if (!schema) {
        return argsToGraphQL(args);
      }
      const definitions = schema.fields[type]?.[field];
      if (!definitions) {
        throw new Error(`fate(graphql): Unknown field '${type}.${field}'.`);
      }
      const fieldArgs =
        resultType && args
          ? Object.fromEntries(
              Object.entries(args).filter(([key, value]) => {
                if (Object.hasOwn(definitions, key) || !isRecord(value)) {
                  return true;
                }
                const nestedArguments = schema.fields[resultType]?.[schemaField(key)];
                const relation = types.get(resultType)?.fields?.[schemaField(key)];
                return !(
                  nestedArguments &&
                  (Object.keys(nestedArguments).length > 0 ||
                    (relation && typeof relation === 'object'))
                );
              }),
            )
          : args;
      const values = validateGraphQLArguments(schema, definitions, fieldArgs, `${type}.${field}`);
      const entries = Object.entries(values).map(([key, value]) => {
        const name = `v${++nextVariableId}`;
        variables[name] = { type: definitions[key].type, value };
        return `${key}: $${name}`;
      });
      return entries.length ? `(${entries.join(', ')})` : '';
    };
    return { argumentsForField, variables };
  };
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

  const execute = async (operations: ReadonlyArray<PendingOperation>) => {
    if (!operations.length) {
      return;
    }
    const kind = operations[0].kind;
    try {
      const variables = Object.assign(
        {},
        ...operations.map((entry) => entry.variables),
      ) as NonNullable<PendingOperation['variables']>;
      const definitions = Object.entries(variables).map(
        ([name, variable]) => `$${name}: ${variable.type}`,
      );
      const variableDefinitions = definitions.length ? `(${definitions.join(', ')})` : '';
      const { data, errors, status } = await graphQLRequest({
        fetchImpl,
        headers,
        query: `${kind} Fate${kind === 'query' ? 'Query' : 'Mutation'}${variableDefinitions} { ${operations
          .map((entry) => `${entry.alias}: ${entry.selection}`)
          .join(' ')} }`,
        url: endpoint,
        variables: schema
          ? Object.fromEntries(
              Object.entries(variables).map(([name, variable]) => [name, variable.value]),
            )
          : undefined,
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

      if (globalErrors.length || !isRecord(data)) {
        throw new GraphQLRequestError(errors, {
          data,
          kind: isRecord(data) || (data == null && errors.length > 0) ? 'execution' : 'protocol',
          message: 'fate(graphql): Expected a GraphQL response data object.',
          status,
        });
      }

      for (const operation of operations) {
        const operationErrors = errorsByAlias.get(operation.alias);
        if (operationErrors?.length) {
          operation.reject(
            new GraphQLRequestError(operationErrors, { data: data[operation.alias], status }),
          );
          continue;
        }

        if (!Object.hasOwn(data, operation.alias)) {
          operation.reject(
            new GraphQLRequestError([], {
              data,
              kind: 'protocol',
              message: `fate(graphql): Response is missing result '${operation.alias}'.`,
              status,
            }),
          );
          continue;
        }

        operation.resolve(operation.transform(data[operation.alias]));
      }
    } catch (error) {
      for (const operation of operations) {
        operation.reject(error);
      }
    }
  };

  const flush = async () => {
    scheduled = false;
    const batch = pending;
    pending = [];

    await Promise.all([
      execute(batch.filter((operation) => operation.kind === 'query')),
      (async () => {
        // Separate executions prevent non-null failures from skipping sibling mutations.
        // Preserve the invocation order that GraphQL previously provided within each batch.
        for (const operation of batch) {
          if (operation.kind === 'mutation') {
            await execute([operation]);
          }
        }
      })(),
    ]);
  };

  const transport: Transport<Mutations> = {
    fetchById(type, ids, select, args) {
      if (!ids.length) {
        return Promise.resolve([]);
      }
      const mapping = byId?.[type];
      if (mapping) {
        const paths = new Set(select);
        const operations = ids.map((id) => {
          const { argumentsForField, variables } = operationArguments();
          const fieldArgs = argumentsForField(schema?.queryType ?? 'Query', mapping.field, {
            [mapping.idArg ?? 'id']: encodeNodeId(type, id),
          });
          const selection = buildRecordSelection({
            args,
            argumentsForField,
            path: '',
            select: paths,
            type,
            types,
          });
          return {
            kind: 'query' as const,
            selection: `${mapping.field}${fieldArgs} { ${selection} }`,
            transform: (value: unknown) =>
              normalizeGraphQLValue({
                decodeNodeId,
                selection: buildSelectionTree(select),
                type,
                types,
                value,
              }),
            variables,
          };
        });
        return Promise.all(operations.map(enqueue)).then((records) =>
          records.filter((record) => record != null),
        );
      }
      if (!nodes) {
        throw new Error(
          `fate(graphql): No refetch mapping for '${type}' and the nodes fallback is disabled.`,
        );
      }
      const { argumentsForField, variables } = operationArguments();
      const globalIds = ids.map((id) => encodeNodeId(type, id));
      const selection = buildRecordSelection({
        args,
        argumentsForField,
        path: '',
        select,
        type,
        types,
      });
      return enqueue({
        kind: 'query',
        selection: `nodes${argumentsForField(schema?.queryType ?? 'Query', 'nodes', { ids: globalIds })} { ... on ${assertIdentifier(
          type,
          'type',
        )} { ${selection} } }`,
        transform: (value) =>
          (Array.isArray(value) ? value : []).filter(Boolean).map((entry) =>
            normalizeGraphQLValue({
              decodeNodeId,
              selection: buildSelectionTree(select),
              type,
              types,
              value: entry,
            }),
          ),
        variables,
      }) as Promise<Array<unknown>>;
    },
    fetchList(name, select, args) {
      const root = roots?.[name];
      if (!root) {
        throw new Error(`fate(graphql): Missing root list mapping for '${name}'.`);
      }

      const { argumentsForField, variables } = operationArguments();
      const field = assertIdentifier(root.field ?? name, 'field');
      const selection = buildRecordSelection({
        args,
        argumentsForField,
        path: '',
        select,
        type: root.type,
        types,
      });
      const rootArgs = rootArgsToGraphQL({
        args,
        argumentsForField,
        field,
        schema,
        type: root.type,
        types,
      });
      return enqueue({
        kind: 'query',
        selection: `${field}${rootArgs} { edges { cursor node { ${selection} } } pageInfo { endCursor hasNextPage hasPreviousPage startCursor } }`,
        transform: (value) =>
          normalizeGraphQLValue({
            decodeNodeId,
            selection: buildSelectionTree(select),
            type: root.type,
            types,
            value,
          }),
        variables,
      }) as Promise<{
        items: Array<{ cursor: string | undefined; node: unknown }>;
        pagination: Pagination;
      } | null>;
    },
    fetchQuery(name, select, args, context) {
      if (context) {
        const recipe = types.get(context.refetch)?.refetch;
        if (!recipe || recipe.root !== name) {
          throw new Error(`fate(graphql): Missing refetch recipe for '${context.refetch}'.`);
        }
        args = encodeRefetchArgs(recipe, args ?? {}, (id) => encodeNodeId(context.refetch, id));
      }
      const root = roots?.[name];
      if (!root) {
        throw new Error(`fate(graphql): Missing root query mapping for '${name}'.`);
      }

      const { argumentsForField, variables } = operationArguments();
      const field = assertIdentifier(root.field ?? name, 'field');
      const selection =
        root.type === '__value__' || ['Boolean', 'Int', 'Float', 'String', 'ID'].includes(root.type)
          ? ''
          : buildRecordSelection({
              args,
              argumentsForField,
              embedded: root.embedded,
              path: '',
              select,
              type: root.type,
              types,
            });
      const rootArgs = rootArgsToGraphQL({
        args,
        argumentsForField,
        field,
        schema,
        type: root.type,
        types,
      });
      return enqueue({
        kind: 'query',
        selection: `${field}${rootArgs}${selection ? ` { ${selection} }` : ''}`,
        transform: (value) =>
          normalizeGraphQLValue({
            decodeNodeId,
            selection: buildSelectionTree(select),
            type: root.type,
            types,
            value,
          }),
        variables,
      });
    },
    mutate(name, input, select, selectionArgs) {
      const mutation = mutations?.[name as Extract<keyof Mutations, string>];
      if (!mutation) {
        throw new Error(`fate(graphql): Missing mutation mapping for '${name}'.`);
      }

      const { argumentsForField, variables } = operationArguments();
      const field = assertIdentifier(mutation.field, 'mutation');
      const args =
        mutation.inputArg === false
          ? ((input ?? {}) as Record<string, unknown>)
          : { [mutation.inputArg ?? 'input']: input };
      const selection =
        mutation.entity === '__value__' && !mutation.type
          ? ''
          : buildRecordSelection({
              args: selectionArgs,
              argumentsForField,
              embedded: mutation.entity === '__value__',
              path: '',
              select,
              type: mutation.type ?? mutation.entity,
              types,
            });

      return enqueue({
        kind: 'mutation',
        selection: `${field}${argumentsForField(schema?.mutationType ?? 'Mutation', field, args)}${selection ? ` { ${selection} }` : ''}`,
        transform: (value) =>
          normalizeGraphQLValue({
            decodeNodeId,
            selection: buildSelectionTree(select),
            type: mutation.entity,
            types,
            value,
          }),
        variables,
      }) as Promise<Mutations[Extract<keyof Mutations, string>]['output']>;
    },
    mutateDurably,
    separateMutationSelectionArgs: true,
    supportsAliases: true,
  };

  if (live !== false) {
    const liveOptions = typeof live === 'object' ? live : {};
    const liveUrl = liveOptions.url ?? `${endpoint}/stream`;
    const getLiveClient = async () => {
      if (graphQLLiveClient) {
        return graphQLLiveClient;
      }

      const graphQLSSE = await (graphQLSSEModule ??= importGraphQLSSE());
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

  // The live endpoint uses fate's selection protocol, so lower aliases there as
  // for other native transports. Ordinary GraphQL operations keep native aliases.
  const liveTransport = withAliasSupport({ ...transport, supportsAliases: false });
  return {
    ...transport,
    subscribeById: liveTransport.subscribeById,
    subscribeConnection: liveTransport.subscribeConnection,
  };
}
