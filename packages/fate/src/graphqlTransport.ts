import { withAliasSupport } from './alias-transport.ts';
import { responseField, schemaField, typeCondition } from './alias.ts';
import { GraphQLRequestError, type GraphQLErrorPayload } from './graphql-error.ts';
import { readGraphQLIncremental } from './graphqlIncremental.ts';
import {
  graphQLOutputRelations,
  validateGraphQLArguments,
  validateGraphQLRefetchMappings,
  validateGraphQLQueryRefetch,
  type GraphQLArgumentSchema,
  type GraphQLByIdConfig,
} from './graphqlSchema.ts';
import {
  isNormalizationRead,
  registerNormalizationTransport,
  withNormalizationInput,
  type NormalizationInput,
} from './normalization-input.ts';
import { abortable, batchReadControl } from './read-control.ts';
import { isDate, isRecord } from './record.ts';
import { encodeRefetchArgs, getRefetchFields } from './refetch.ts';
import type { ReadContext, Transport } from './transport.ts';
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
  streaming?: boolean;
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
  signal?: AbortSignal;
  transform: (value: unknown) => unknown;
  variables?: Record<string, { type: string; value: unknown }>;
};

type SelectionTree = {
  fields: Map<string, SelectionTree>;
  responseFields: Map<string, { field: string; key: string; selection: SelectionTree }>;
  wireAliases?: {
    byField: Map<string, Set<string>>;
    fieldsByAlias: Map<string, string>;
  };
};

const createSelectionTree = (): SelectionTree => ({
  fields: new Map(),
  responseFields: new Map(),
});

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

  if (isDate(value)) {
    return JSON.stringify(value);
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
  const root = createSelectionTree();

  for (const path of select) {
    let current = root;
    for (const segment of path.split('.')) {
      if (!segment) {
        continue;
      }

      let next = current.fields.get(segment);
      if (!next) {
        next = createSelectionTree();
        current.fields.set(segment, next);
        const responseKey = responseField(segment);
        if (!current.responseFields.has(responseKey)) {
          current.responseFields.set(responseKey, {
            field: schemaField(segment),
            key: segment,
            selection: next,
          });
        }
      }
      current = next;
    }
  }

  return root;
};

const concreteFieldName = (tree: SelectionTree, field: string, type: string): string => {
  let alias = `fate_union_${type.length}_${type}_${responseField(field)}`;
  while (tree.responseFields.has(alias)) {
    alias = `_${alias}`;
  }
  const { byField, fieldsByAlias } = (tree.wireAliases ??= {
    byField: new Map(),
    fieldsByAlias: new Map(),
  });
  let aliases = byField.get(field);
  if (!aliases) {
    aliases = new Set();
    byField.set(field, aliases);
  }
  aliases.add(alias);
  fieldsByAlias.set(alias, field);
  return `${assertIdentifier(alias, 'alias')}: ${assertIdentifier(schemaField(field), 'field')}`;
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
  schema,
  tree,
  type,
  types,
}: {
  args?: Record<string, unknown>;
  argumentsForField: ArgumentsForField;
  embedded?: boolean;
  path: string;
  schema?: GraphQLArgumentSchema;
  tree: SelectionTree;
  type: string;
  types: ReadonlyMap<string, TypeConfig>;
}): string => {
  const hasConflictingTypes = (field: string, concreteTypes: ReadonlyArray<string>) =>
    concreteTypes.length > 1 &&
    concreteTypes.some(
      (type) => schema?.outputs?.[type]?.[field] !== schema?.outputs?.[concreteTypes[0]]?.[field],
    );

  const walk = (
    currentType: string,
    currentTree: SelectionTree,
    currentPath: string,
    embedded = false,
  ): string => {
    const config = getTypeConfig(types, currentType);
    const possibleTypes = config.possibleTypes ?? [];
    const needsConcreteIds =
      !embedded &&
      possibleTypes.length > 0 &&
      schema?.outputs !== undefined &&
      !schema.outputs[currentType]?.id;
    const fields = new Set([
      ...currentTree.fields.keys(),
      ...(embedded ? [] : needsConcreteIds ? ['__typename'] : ['id', '__typename']),
      ...getRefetchFields(config.refetch),
    ]);
    const lines: Array<string> = [];
    let fragments: Map<string, Array<string>> | undefined;
    const fragment = (type: string) => {
      fragments ??= new Map();
      let lines = fragments.get(type);
      if (!lines) {
        lines = [];
        fragments.set(type, lines);
      }
      return lines;
    };

    for (const field of [...fields].sort()) {
      if (field === '__typename') {
        lines.push('__typename');
        continue;
      }

      const childTree = currentTree.fields.get(field) ?? createSelectionTree();
      const sourceField = schemaField(field);
      const condition = typeCondition(field);
      if (condition && condition !== currentType && !possibleTypes.includes(condition)) {
        continue;
      }
      if (needsConcreteIds && field === 'id') {
        continue;
      }
      const fieldPath = currentPath ? `${currentPath}.${field}` : field;
      const responseName = field.includes(':')
        ? `${assertIdentifier(responseField(field), 'alias')}: ${assertIdentifier(sourceField, 'field')}`
        : assertIdentifier(field, 'field');
      const fieldTypes = condition
        ? [condition]
        : sourceField === '__typename'
          ? [currentType]
          : (schema?.unions?.[currentType] ??
            (needsConcreteIds && sourceField === 'id' ? possibleTypes : [currentType]));

      const needsAlias = hasConflictingTypes(sourceField, fieldTypes);
      for (const fieldType of fieldTypes) {
        const fieldName = needsAlias
          ? concreteFieldName(currentTree, field, fieldType)
          : responseName;
        const selections = fieldType === currentType ? lines : fragment(fieldType);
        const descriptor = types.get(fieldType)?.fields?.[sourceField];
        if (sourceField === '__typename') {
          selections.push(fieldName);
          continue;
        }
        const resultType =
          descriptor && typeof descriptor === 'object'
            ? 'type' in descriptor
              ? descriptor.type
              : 'embedded' in descriptor
                ? descriptor.embedded
                : descriptor.listOf
            : undefined;
        const fieldArguments = argumentsForField(
          fieldType,
          sourceField,
          getArgsAtPath(args, fieldPath),
          resultType,
        );

        if (descriptor && typeof descriptor === 'object' && 'type' in descriptor) {
          selections.push(
            `${fieldName}${fieldArguments} { ${walk(descriptor.type, childTree, fieldPath)} }`,
          );
          continue;
        }

        if (descriptor && typeof descriptor === 'object' && 'embedded' in descriptor) {
          selections.push(
            `${fieldName}${fieldArguments} { ${walk(descriptor.embedded, childTree, fieldPath, true)} }`,
          );
          continue;
        }

        if (descriptor && typeof descriptor === 'object' && 'listOf' in descriptor) {
          if (descriptor.array) {
            selections.push(
              `${fieldName}${fieldArguments} { ${walk(descriptor.listOf, childTree, fieldPath)} }`,
            );
            continue;
          }
          selections.push(
            `${fieldName}${fieldArguments} { edges { cursor node { ${walk(
              descriptor.listOf,
              childTree,
              fieldPath,
            )} } } pageInfo { endCursor hasNextPage hasPreviousPage startCursor } }`,
          );
          continue;
        }

        selections.push(`${fieldName}${fieldArguments}`);
      }
    }

    const aliasIds = needsConcreteIds && hasConflictingTypes('id', possibleTypes);
    for (const concrete of possibleTypes) {
      if (needsConcreteIds) {
        fragment(concrete).push(aliasIds ? concreteFieldName(currentTree, 'id', concrete) : 'id');
      }
      for (const field of getRefetchFields(types.get(concrete)?.refetch)) {
        if (!currentTree.fields.has(field) && (embedded || field !== 'id')) {
          const fieldName = hasConflictingTypes(field, possibleTypes)
            ? concreteFieldName(currentTree, field, concrete)
            : field;
          fragment(concrete).push(`${fieldName}${argumentsForField(concrete, field)}`);
        }
      }
    }
    for (const [concrete, fields] of fragments ?? []) {
      lines.push(`... on ${assertIdentifier(concrete, 'type')} { ${fields.join(' ')} }`);
    }
    return lines.join(' ');
  };

  return walk(type, tree, path, embedded);
};

type GraphQLValueShape = 'connection' | 'record' | 'scalar';

class GraphQLInput implements NormalizationInput {
  private readonly children = new Map<string, Map<string | undefined, GraphQLInput>>();
  private readonly responseKeys = new Map<string, string>();

  constructor(
    private readonly decodeNodeId: (type: string, id: string | number) => string | number,
    private readonly types: ReadonlyMap<string, TypeConfig>,
    private readonly selection?: SelectionTree,
    private readonly type?: string,
    private readonly shape: GraphQLValueShape = 'record',
  ) {
    for (const [responseKey, field] of selection?.responseFields ?? []) {
      if (field.key !== responseKey) {
        this.responseKeys.set(field.key, responseKey);
      }
    }
  }

  keys(record: AnyRecord): Array<string> {
    const keys = Object.keys(record);
    const wireAliases = this.selection?.wireAliases;
    if (this.responseKeys.size || wireAliases) {
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index];
        keys[index] =
          wireAliases?.fieldsByAlias.get(key) ??
          this.selection?.responseFields.get(key)?.key ??
          key;
      }
    }
    return keys;
  }

  private responseKey(record: AnyRecord, key: string): string {
    const aliases = this.selection?.wireAliases?.byField.get(key);
    if (aliases) {
      for (const alias of aliases) {
        if (Object.hasOwn(record, alias)) {
          return alias;
        }
      }
    }
    return this.responseKeys.get(key) ?? key;
  }

  has(record: AnyRecord, key: string): boolean {
    return Object.hasOwn(record, this.responseKey(record, key));
  }

  get(record: AnyRecord, key: string): unknown {
    const value = record[this.responseKey(record, key)];
    if (key !== 'id' && (!key.includes(':') || schemaField(key) !== 'id')) {
      return value;
    }
    const type = typeof record.__typename === 'string' ? record.__typename : this.type;
    return type && (typeof value === 'string' || typeof value === 'number')
      ? this.decodeNodeId(type, value)
      : value;
  }

  child(record: AnyRecord, key: string): GraphQLInput {
    const type = typeof record.__typename === 'string' ? record.__typename : this.type;
    let byType = this.children.get(key);
    const cached = byType?.get(type);
    if (cached) {
      return cached;
    }
    const descriptor = type ? this.types.get(type)?.fields?.[schemaField(key)] : undefined;
    const childType =
      descriptor && typeof descriptor === 'object'
        ? 'type' in descriptor
          ? descriptor.type
          : 'embedded' in descriptor
            ? descriptor.embedded
            : descriptor.listOf
        : undefined;
    const shape =
      !descriptor || descriptor === 'scalar'
        ? 'scalar'
        : 'listOf' in descriptor && !descriptor.array
          ? 'connection'
          : 'record';
    const responseKey = this.responseKeys.get(key) ?? key;
    const selection =
      this.selection?.responseFields.get(responseKey)?.selection ?? this.selection?.fields.get(key);
    const child = new GraphQLInput(this.decodeNodeId, this.types, selection, childType, shape);
    if (!byType) {
      byType = new Map();
      this.children.set(key, byType);
    }
    byType.set(type, child);
    return child;
  }

  connection(value: unknown, materialize = false): unknown {
    if (
      this.shape !== 'connection' ||
      !isRecord(value) ||
      !(value.edges === null || Array.isArray(value.edges))
    ) {
      return value;
    }
    const pageInfo = isRecord(value.pageInfo) ? value.pageInfo : {};
    const items: Array<{ cursor: string | undefined; node: unknown }> = [];
    for (const edge of value.edges ?? []) {
      if (isRecord(edge) && edge.node != null) {
        items.push(
          !materialize && (edge.cursor === undefined || typeof edge.cursor === 'string')
            ? (edge as { cursor: string | undefined; node: unknown })
            : {
                cursor: typeof edge.cursor === 'string' ? edge.cursor : undefined,
                node: materialize ? this.materializeRecord(edge.node) : edge.node,
              },
        );
      }
    }
    return {
      items,
      pagination: {
        hasNext: pageInfo.hasNextPage === true,
        hasPrevious: pageInfo.hasPreviousPage === true,
        nextCursor: typeof pageInfo.endCursor === 'string' ? pageInfo.endCursor : undefined,
        previousCursor: typeof pageInfo.startCursor === 'string' ? pageInfo.startCursor : undefined,
      } satisfies Pagination,
    };
  }

  materialize(value: unknown): unknown {
    if (this.shape === 'scalar') {
      return structuredClone(value);
    }
    const connection = this.connection(value, true);
    return connection !== value ? connection : this.materializeRecord(value);
  }

  private materializeRecord(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) =>
        entry && typeof entry === 'object' ? this.materializeRecord(entry) : entry,
      );
    }
    if (!isRecord(value)) {
      return value;
    }
    const result: AnyRecord = {};
    for (const key of this.keys(value)) {
      const entry = this.get(value, key);
      result[key] =
        entry && typeof entry === 'object' ? this.child(value, key).materialize(entry) : entry;
    }
    return result;
  }

  read(value: unknown): unknown {
    return withNormalizationInput(this.connection(value), this);
  }
}

const normalizeGraphQLValue = ({
  context,
  decodeNodeId,
  selection,
  shape,
  type,
  types,
  value,
}: {
  context?: ReadContext;
  decodeNodeId: (type: string, id: string | number) => string | number;
  selection?: SelectionTree;
  shape?: GraphQLValueShape;
  type?: string;
  types: ReadonlyMap<string, TypeConfig>;
  value: unknown;
}): unknown => {
  const input = new GraphQLInput(decodeNodeId, types, selection, type, shape);
  return isNormalizationRead(context) ? input.read(value) : input.materialize(value);
};

const graphQLRequest = async ({
  fetchImpl,
  headers,
  query,
  signal,
  streaming,
  url,
  variables,
}: {
  fetchImpl: FetchLike;
  headers: HeadersFactory | undefined;
  query: string;
  signal?: AbortSignal;
  streaming?: boolean;
  url: string;
  variables?: Record<string, unknown>;
}) => {
  const requestHeadersValue = await requestHeaders(
    streaming
      ? {
          accept:
            'multipart/mixed;incrementalSpec=v0.2, application/graphql-response+json, application/json',
          'content-type': 'application/json',
        }
      : { 'content-type': 'application/json' },
    headers,
  );
  signal?.throwIfAborted();
  const response = await fetchImpl(url, {
    ...(signal ? { signal } : {}),
    body: JSON.stringify({ query, variables }),
    headers: requestHeadersValue,
    method: 'POST',
  });

  if (!response.ok) {
    throw await responseError(response);
  }

  return response;
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
  streaming = false,
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
                const sourceField = schemaField(key);
                const acceptsNestedArgs = (childType: string) => {
                  const nestedArguments = schema.fields[childType]?.[sourceField];
                  const relation = types.get(childType)?.fields?.[sourceField];
                  return (
                    nestedArguments &&
                    (Object.keys(nestedArguments).length > 0 ||
                      (relation && typeof relation === 'object'))
                  );
                };
                const condition = typeCondition(key);
                const members = condition ? undefined : schema.unions?.[resultType];
                return members?.length
                  ? !members.every(acceptsNestedArgs)
                  : !acceptsNestedArgs(condition ?? resultType);
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
    abortable(
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
      }),
      operation.signal,
    );

  const execute = async (queued: ReadonlyArray<PendingOperation>) => {
    const operations = queued.filter((operation) => {
      if (operation.signal?.aborted) {
        operation.reject(operation.signal.reason);
        return false;
      }
      return true;
    });
    if (!operations.length) {
      return;
    }
    const kind = operations[0].kind;
    const control = batchReadControl(operations);
    try {
      const variables = Object.assign(
        {},
        ...operations.map((entry) => entry.variables),
      ) as NonNullable<PendingOperation['variables']>;
      const definitions = Object.entries(variables).map(
        ([name, variable]) => `$${name}: ${variable.type}`,
      );
      const variableDefinitions = definitions.length ? `(${definitions.join(', ')})` : '';
      const incremental = streaming && kind === 'query';
      const response = await graphQLRequest({
        fetchImpl,
        headers,
        query: `${kind} Fate${kind === 'query' ? 'Query' : 'Mutation'}${variableDefinitions} { ${operations
          .map((entry) =>
            incremental
              ? `... @defer(label: "${entry.alias}") { ${entry.alias}: ${entry.selection} }`
              : `${entry.alias}: ${entry.selection}`,
          )
          .join(' ')} }`,
        signal: control?.signal,
        streaming: incremental,
        url: endpoint,
        variables: schema
          ? Object.fromEntries(
              Object.entries(variables).map(([name, variable]) => [name, variable.value]),
            )
          : undefined,
      });
      const status = response.status;
      const deliver = (
        operation: PendingOperation,
        data: unknown,
        errors: ReadonlyArray<GraphQLErrorPayload>,
      ) => {
        if (operation.signal?.aborted) {
          operation.reject(operation.signal.reason);
        } else if (errors.length) {
          operation.reject(new GraphQLRequestError(errors, { data, status }));
        } else {
          operation.resolve(operation.transform(data));
        }
      };
      if (
        incremental &&
        response.headers.get('content-type')?.toLowerCase().startsWith('multipart/mixed')
      ) {
        const waiting = new Map(operations.map((operation) => [operation.alias, operation]));
        await readGraphQLIncremental(
          response,
          new Set(waiting.keys()),
          ({ alias, data, errors }) => {
            const operation = waiting.get(alias)!;
            deliver(operation, data, errors);
            waiting.delete(alias);
            control?.complete(operation);
          },
          control?.signal,
        );
        return;
      }
      const { data, errors = [] } = assertGraphQLResponse(await response.json());
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
        if (operation.signal?.aborted) {
          operation.reject(operation.signal.reason);
          continue;
        }

        if (!errorsByAlias.has(operation.alias) && !Object.hasOwn(data, operation.alias)) {
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

        deliver(operation, data[operation.alias], errorsByAlias.get(operation.alias) ?? []);
      }
    } catch (error) {
      for (const operation of operations) {
        operation.reject(error);
      }
    } finally {
      control?.dispose();
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
    fetchById(type, ids, select, args, context) {
      if (!ids.length) {
        return Promise.resolve([]);
      }
      const tree = buildSelectionTree(select);
      const input = new GraphQLInput(decodeNodeId, types, tree, type);
      const normalize = (value: unknown) =>
        isNormalizationRead(context) ? input.read(value) : input.materialize(value);
      const mapping = byId?.[type];
      if (mapping) {
        const operations = ids.map((id) => {
          const { argumentsForField, variables } = operationArguments();
          const fieldArgs = argumentsForField(schema?.queryType ?? 'Query', mapping.field, {
            [mapping.idArg ?? 'id']: encodeNodeId(type, id),
          });
          const selection = buildRecordSelection({
            args,
            argumentsForField,
            path: '',
            schema,
            tree,
            type,
            types,
          });
          return {
            kind: 'query' as const,
            selection: `${mapping.field}${fieldArgs} { ${selection} }`,
            signal: context?.signal,
            transform: normalize,
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
        schema,
        tree,
        type,
        types,
      });
      return enqueue({
        kind: 'query',
        selection: `nodes${argumentsForField(schema?.queryType ?? 'Query', 'nodes', { ids: globalIds })} { ... on ${assertIdentifier(
          type,
          'type',
        )} { ${selection} } }`,
        signal: context?.signal,
        transform: (value) => (Array.isArray(value) ? value : []).filter(Boolean).map(normalize),
        variables,
      }) as Promise<Array<unknown>>;
    },
    fetchList(name, select, args, context) {
      const root = roots?.[name];
      if (!root) {
        throw new Error(`fate(graphql): Missing root list mapping for '${name}'.`);
      }

      const { argumentsForField, variables } = operationArguments();
      const field = assertIdentifier(root.field ?? name, 'field');
      const tree = buildSelectionTree(select);
      const selection = buildRecordSelection({
        args,
        argumentsForField,
        path: '',
        schema,
        tree,
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
        signal: context?.signal,
        transform: (value) =>
          normalizeGraphQLValue({
            context,
            decodeNodeId,
            selection: tree,
            shape: 'connection',
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
      const refetch = context?.refetch;
      if (refetch) {
        const recipe = types.get(refetch)?.refetch;
        if (!recipe || recipe.root !== name) {
          throw new Error(`fate(graphql): Missing refetch recipe for '${refetch}'.`);
        }
        args = encodeRefetchArgs(recipe, args ?? {}, (id) => encodeNodeId(refetch, id));
      }
      const root = roots?.[name];
      if (!root) {
        throw new Error(`fate(graphql): Missing root query mapping for '${name}'.`);
      }

      const { argumentsForField, variables } = operationArguments();
      const field = assertIdentifier(root.field ?? name, 'field');
      const tree = buildSelectionTree(select);
      const selection =
        root.type === '__value__' ||
        ['Boolean', 'Int', 'Float', 'String', 'ID'].includes(root.type) ||
        schema?.scalars?.includes(root.type)
          ? ''
          : buildRecordSelection({
              args,
              argumentsForField,
              embedded: root.embedded,
              path: '',
              schema,
              tree,
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
        signal: context?.signal,
        transform: (value) =>
          normalizeGraphQLValue({
            context,
            decodeNodeId,
            selection: tree,
            shape: selection ? 'record' : 'scalar',
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
      const tree = buildSelectionTree(select);
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
              schema,
              tree,
              type: mutation.type ?? mutation.entity,
              types,
            });

      return enqueue({
        kind: 'mutation',
        selection: `${field}${argumentsForField(schema?.mutationType ?? 'Mutation', field, args)}${selection ? ` { ${selection} }` : ''}`,
        transform: (value) =>
          normalizeGraphQLValue({
            decodeNodeId,
            selection: tree,
            shape: selection ? 'record' : 'scalar',
            type: mutation.type ?? mutation.entity,
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
  return registerNormalizationTransport({
    ...transport,
    subscribeById: liveTransport.subscribeById,
    subscribeConnection: liveTransport.subscribeConnection,
  });
}
