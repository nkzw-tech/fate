import type { TRPCError } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import type { FateClient } from './client.js';
import { GraphQLRequestError } from './graphql-error.ts';
import type {
  GraphQLSelectedResult,
  GraphQLMutationCallResult,
  GraphQLSelectionBrand,
} from './graphql-types.ts';
import type { MutationIdentity } from './persistence-types.ts';
import { FateRequestError } from './protocol.ts';
import { isRecord } from './record.ts';
import { toEntityId } from './ref.ts';
import type { MergeSelectedResults, SelectedResult } from './selection-result.ts';
import { getSelectionPlan, type SelectionPlan } from './selection.ts';
import type {
  AnyRecord,
  ConnectionMetadata,
  Deferred,
  Entity,
  MutationDefinition,
  MutationEntity,
  MutationIdentifier,
  MutationInput,
  MutationResult,
  OptimisticUpdate,
  Selection,
  SelectionOf,
  TypeConfig,
  ValidateSelection,
  View,
  __FateEntityBrand,
  __FateSelectionBrand,
} from './types.ts';
import { getViewTag, MutationKind, ViewKind } from './types.ts';

type MutationDefinitionFor<T extends Entity, I, R> = [R] extends [
  GraphQLSelectedResult<infer Result>,
]
  ? MutationDefinition<T, I, Result> & { readonly [GraphQLSelectionBrand]: Result }
  : MutationDefinition<T, I, R>;

/**
 * Defines a mutation for a given entity type, preserving the input and output
 * types for transports.
 */
export function mutation<T extends Entity, I, R>(
  entity: T['__typename'],
): MutationDefinitionFor<T, I, R> {
  return Object.freeze({
    entity,
    [MutationKind]: true,
  }) as MutationDefinitionFor<T, I, R>;
}

export function valueMutation<I, R>(): MutationDefinitionFor<{ __typename: '__value__' }, I, R> {
  return mutation<{ __typename: '__value__' }, I, R>('__value__');
}

/** Where (or if) to insert the resulting record into relevant lists. */
export type InsertPosition = 'after' | 'before' | 'none';

type ResolvedInsertionTarget<TName extends string> =
  | ReadonlyArray<Readonly<{ __typename: TName }> | null>
  | Readonly<{
      items: ReadonlyArray<Readonly<{ node: Readonly<{ __typename: TName }> | null }>>;
    }>;

/** A list, connection, or deferred list reference returned by this client. */
export type InsertionTarget<TName extends string = string> =
  | ResolvedInsertionTarget<TName>
  | Deferred<ResolvedInsertionTarget<TName> | null | undefined>;

/** Insert the returned entity into one specific list, preserving its query scope. */
export type ListInsertion<TName extends string = string> = Readonly<{
  into: InsertionTarget<TName>;
  position: Exclude<InsertPosition, 'none'>;
}>;

export type MutationInsertion<TName extends string = string> =
  | InsertPosition
  | ListInsertion<TName>
  | ReadonlyArray<ListInsertion<TName>>;

/** @internal Serializable insertion targets captured before executing a mutation. */
export type ResolvedInsertion = Readonly<{
  list: ConnectionMetadata;
  position: Exclude<InsertPosition, 'none'>;
}>;
export type ResolvedMutationInsertion = InsertPosition | ReadonlyArray<ResolvedInsertion>;

/** @internal Validate serialized insertion descriptors before journal replay. */
export function isResolvedMutationInsertion(value: unknown): value is ResolvedMutationInsertion {
  if (typeof value === 'string') {
    return value === 'none' || value === 'before' || value === 'after';
  }
  if (!Array.isArray(value)) {
    return false;
  }
  const keys = new Set<string>();
  return value.every((entry) => {
    if (
      !isRecord(entry) ||
      (entry.position !== 'before' && entry.position !== 'after') ||
      !isRecord(entry.list)
    ) {
      return false;
    }
    const list = entry.list;
    if (
      typeof list.key !== 'string' ||
      !list.key ||
      !['owner', 'field', 'procedure', 'type'].every(
        (key) => typeof list[key] === 'string' && list[key].length > 0,
      ) ||
      (list.hash !== undefined && typeof list.hash !== 'string') ||
      typeof list.root !== 'boolean' ||
      keys.has(list.key)
    ) {
      return false;
    }
    keys.add(list.key);
    return true;
  });
}
/**
 * Options accepted by a mutation invocation, including optimistic updates and
 * optional selection for the returned payload.
 */
export type MutationOptions<Identifier extends MutationIdentifier<any, any, any>> = {
  /** Optional arguments to pass to the mutation resolver. */
  args?: Record<string, unknown>;
  /** If true, deletes the record with the ID specified in the input. */
  delete?: boolean;
  /** Input data for the mutation. */
  input: Omit<MutationInput<Identifier>, 'select'>;
  insert?: MutationInsertion<MutationEntity<Identifier>['__typename']>;
  /** Optional optimistic update to apply immediately. */
  optimistic?: OptimisticUpdate<MutationResult<Identifier>>;
  /** Skip durable delivery for this call, even when persistence is configured. */
  persist?: boolean;
  /** Fields to select from a value mutation result. */
  select?: {
    [K in keyof NonNullable<MutationResult<Identifier>>]?: true | Record<string, unknown>;
  };
  /** Optional view specifying which fields to select from the server. */
  view?: View<MutationEntity<Identifier>, Selection<MutationEntity<Identifier>>>;
};

/**
 * Callable mutation entry point returned on the client that resolves to either
 * a successful result or an error.
 */
type MutationResponse<Result> = Promise<
  { error: undefined; result: Result } | { error: Error; result: undefined }
>;

export type MutationFunction<I extends MutationIdentifier<any, any, any>> = I extends {
  readonly [GraphQLSelectionBrand]: unknown;
}
  ? <
      const V extends MutationOptions<I>['view'] = undefined,
      const S extends MutationOptions<I>['select'] = undefined,
    >(
      options: Omit<MutationOptions<I>, 'view' | 'select'> & { select?: S; view?: V },
    ) => MutationResponse<GraphQLMutationCallResult<I, { select: S; view: V }, MutationResult<I>>>
  : (options: MutationOptions<I>) => MutationResponse<MutationResult<I>>;

type ActionEntity<I extends MutationIdentifier<any, any, any>> =
  MutationEntity<I>['__typename'] extends '__value__'
    ? Extract<NonNullable<MutationResult<I>>, object> & Entity
    : MutationEntity<I>;

type ActionSelection<S> = typeof __FateSelectionBrand extends keyof S ? SelectionOf<S> : S;

type ValidateActionSelection<I extends MutationIdentifier<any, any, any>, S> = S extends (
  ...args: Array<any>
) => unknown
  ? never
  : typeof __FateEntityBrand extends keyof S
    ? S extends View<ActionEntity<I>, any>
      ? unknown
      : never
    : ValidateSelection<ActionEntity<I>, S>;

type ActionOptions<
  I extends MutationIdentifier<any, any, any>,
  Bound extends boolean,
> = Bound extends true
  ? Omit<MutationOptions<I>, 'select' | 'view'> & { select?: never; view?: never }
  : MutationOptions<I>;

type ExpandedActionResult<
  I extends MutationIdentifier<any, any, any>,
  Result,
  Added,
  Bound extends boolean,
> = MergeSelectedResults<
  Bound extends true ? Result : SelectedResult<MutationResult<I>, Record<never, never>>,
  SelectedResult<MutationResult<I>, ActionSelection<Added>>
>;

/** React action state has a fixed result contract, expanded by binding selections with `.with()`. */
export type MutationAction<
  I extends MutationIdentifier<any, any, any>,
  Result = GraphQLMutationCallResult<I, Record<never, never>, MutationResult<I>>,
  Bound extends boolean = false,
> = {
  (previousState: unknown, options: ActionOptions<I, Bound>): MutationResponse<Result>;
  (previousState: unknown, options: 'reset'): Promise<null>;
  (
    previousState: unknown,
    options: ActionOptions<I, Bound> | 'reset',
  ): Promise<Awaited<MutationResponse<Result>> | null>;
  with<const Added extends object>(
    selection: Added & ValidateActionSelection<I, Added>,
  ): MutationAction<I, ExpandedActionResult<I, Result, Added, Bound>, true>;
};

/** @internal Bind reusable selections without changing the underlying mutation's behavior. */
export function wrapAction<I extends MutationIdentifier<any, any, any>>(
  mutation: MutationFunction<I>,
  selections: ReadonlyArray<AnyRecord> = [],
): MutationAction<I> {
  const view = selections.length
    ? (Object.fromEntries(
        selections.map((select, index) => [
          getViewTag(`action:${index}`),
          { select, [ViewKind]: true },
        ]),
      ) as View<MutationEntity<I>>)
    : undefined;
  if (view) {
    getSelectionPlan(view, null);
  }
  return Object.assign(
    async (_previousState: unknown, options: MutationOptions<I> | 'reset') => {
      if (options === 'reset') {
        return null;
      }
      if (view && ('view' in options || 'select' in options)) {
        throw new Error('fate: An action selection bound with .with() cannot be overridden.');
      }
      return mutation(view ? { ...options, view } : options);
    },
    {
      with: (selection: AnyRecord) => {
        if (!isRecord(selection)) {
          throw new Error('fate: Action .with() requires a selection with view parameters bound.');
        }
        return wrapAction(mutation, [...selections, selection]);
      },
    },
  ) as MutationAction<I>;
}

type MutationIdentifierFor<K extends string, Def extends MutationDefinition<any, any, any>> = Def &
  Readonly<{ key: K }>;

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never;

type NestedValue<Path extends string, Value> = Path extends `${infer Head}.${infer Tail}`
  ? { [K in Head]: NestedValue<Tail, Value> }
  : { [K in Path]: Value };

/**
 * Base type for client mutations.
 */

export type FateMutations = Record<string, MutationDefinition<any, any, any>>;

type MutationTreeFromRecord<
  Mutations extends FateMutations,
  ValueMap extends Record<string, unknown>,
> = [keyof Mutations] extends [never]
  ? object
  : UnionToIntersection<
      {
        [K in keyof Mutations & string]: NestedValue<K, ValueMap[K]>;
      }[keyof Mutations & string]
    >;

export type MutationFunctionsFor<Mutations extends FateMutations> = MutationTreeFromRecord<
  Mutations,
  {
    [K in keyof Mutations & string]: MutationFunction<MutationIdentifierFor<K, Mutations[K]>>;
  }
>;

export type MutationActionsFor<Mutations extends FateMutations> = MutationTreeFromRecord<
  Mutations,
  {
    [K in keyof Mutations & string]: MutationAction<MutationIdentifierFor<K, Mutations[K]>>;
  }
>;

const collectImplicitSelectedPaths = (value: AnyRecord): Set<string> => {
  const paths = new Set<string>();

  const walk = (current: unknown, prefix: string | null) => {
    if (!current || typeof current !== 'object') {
      if (prefix) {
        paths.add(prefix);
      }
      return;
    }

    if (Array.isArray(current)) {
      if (prefix) {
        paths.add(prefix);
      }

      for (const child of current) {
        walk(child, prefix);
      }
      return;
    }

    for (const [key, child] of Object.entries(current as AnyRecord)) {
      const next = prefix ? `${prefix}.${key}` : key;
      paths.add(next);
      walk(child, next);
    }
  };

  walk(value, null);
  return paths;
};

const maybeGetId = (getId: TypeConfig['getId'], input: AnyRecord) => {
  try {
    return getId(input);
  } catch {
    return null;
  }
};

const emptySet: ReadonlySet<string> = new Set();

/** @internal Serializable input to a live or restored mutation. */
export type MutationCommand = {
  args?: AnyRecord;
  delete?: boolean;
  entity: string;
  input: AnyRecord;
  insert: ResolvedMutationInsertion;
  key: string;
  optimistic?: AnyRecord;
  plan?: SelectionPlan;
};

/** @internal Creates the same optimistic/confirmation machinery for live and restored calls. */
export function prepareMutation(
  client: FateClient<any, any>,
  command: MutationCommand,
  config: TypeConfig | undefined,
  durable = false,
) {
  const { args, delete: deleteRecord, entity, input, insert, key, optimistic, plan } = command;
  const position = typeof insert === 'string' ? insert : 'none';
  if (!config) {
    if (deleteRecord || optimistic) {
      throw new Error(`fate: Value mutation '${key}' does not support entity updates.`);
    }
    return {
      commit: (_result: unknown) => {},
      entityId: null,
      execute: (identity?: MutationIdentity) =>
        client.executeMutation(key, input, plan?.paths ?? new Set(), { args, identity }),
      rollback: () => {},
    };
  }
  const id = maybeGetId(config.getId, input);
  const optimisticRecord = optimistic
    ? id != null
      ? { id, ...optimistic }
      : optimistic
    : undefined;
  const optimisticRecordId = optimisticRecord ? maybeGetId(config.getId, optimisticRecord) : null;
  const optimisticEntityId =
    id != null
      ? toEntityId(entity, id)
      : optimisticRecordId != null
        ? toEntityId(entity, optimisticRecordId)
        : null;
  const optimisticSelection = optimisticRecord
    ? collectImplicitSelectedPaths(optimisticRecord)
    : undefined;
  const selection = new Set([...(plan?.paths ?? []), ...(optimisticSelection ?? [])]);
  if (deleteRecord && id == null) {
    throw new Error(`fate: Mutation '${key}' requires an 'id' to delete.`);
  }
  const release = client.retainMutationLists(insert);
  let settle: ReturnType<typeof client.store.optimisticUpdate>;
  try {
    settle = client.store.optimisticUpdate(() => {
      if (optimisticRecord && optimisticEntityId) {
        client.write(entity, optimisticRecord, optimisticSelection ?? emptySet, plan, position);
        if (!deleteRecord && typeof insert !== 'string') {
          client.insertMutationTargets(optimisticEntityId, insert);
        }
      }
      if (deleteRecord && id != null) {
        client.deleteRecord(entity, id);
      }
    }, durable);
  } catch (error) {
    release();
    throw error;
  }
  return {
    commit: (result: unknown) => {
      try {
        settle(() => {
          if (result && typeof result === 'object' && (!deleteRecord || plan)) {
            client.writeMutationResult(
              entity,
              result as AnyRecord,
              collectImplicitSelectedPaths(result as AnyRecord),
              plan,
              position,
            );
            const resultId = maybeGetId(config.getId, result as AnyRecord);
            if (!deleteRecord && resultId != null && typeof insert !== 'string') {
              client.insertMutationTargets(toEntityId(entity, resultId), insert);
            }
            if (optimisticEntityId && resultId != null) {
              client.resolveOptimisticEntity(optimisticEntityId, toEntityId(entity, resultId));
            }
            if (optimisticRecordId != null && resultId != null && optimisticRecordId !== resultId) {
              client.deleteRecord(entity, optimisticRecordId);
            }
          }
          if (deleteRecord && id != null) {
            client.deleteRecord(entity, id);
          }
        });
      } finally {
        release();
      }
    },
    entityId: optimisticEntityId,
    execute: (identity?: MutationIdentity) =>
      client.executeMutation(key, input, selection, { args, identity, plan }),
    rollback: () => {
      try {
        settle();
      } finally {
        release();
      }
    },
  };
}

/** Binds a mutation's optimistic updates, cache writes, and error handling. */
export function wrapMutation<
  I extends MutationIdentifier<any, any, any>,
  M extends Record<string, MutationDefinition<any, any, any>>,
>(client: FateClient<any, M>, identifier: I): MutationFunction<I> {
  const config =
    identifier.entity === '__value__' ? undefined : client.getTypeConfig(identifier.entity);

  return (async ({
    args,
    delete: deleteRecord,
    input,
    insert = 'none',
    optimistic,
    persist,
    select,
    view,
  }: MutationOptions<I>) => {
    const command: MutationCommand = {
      args,
      delete: deleteRecord,
      entity: identifier.entity,
      input,
      insert: client.resolveMutationInsertion(identifier.entity, insert),
      key: identifier.key,
      optimistic: optimistic as AnyRecord | undefined,
      plan: view
        ? getSelectionPlan(view, null)
        : select
          ? getSelectionPlan(select as View<any, any>, null)
          : undefined,
    };
    // Durable admission can await restoration and disk writes before preparation
    // acquires its own pins. Keep the caller's targets alive throughout that gap.
    const release = client.persistence ? client.retainMutationLists(command.insert) : undefined;
    try {
      if (client.persistence && persist !== false) {
        try {
          const result = (await client.withPersistenceLifecycle(() =>
            client.persistMutation(command),
          )) as MutationResult<I>;
          return { error: undefined, result };
        } catch (error) {
          return handleMutationError(identifier.key, error);
        }
      }

      if (client.persistence) {
        await client.withPersistenceLifecycle(() => client.persistence!.ready);
      }
      client.assertPersistenceActive();
      // Preparation failures reject directly, as they did before persistence.
      const operation = prepareMutation(client, command, config);
      const performMutation = async () => {
        try {
          const result = (await operation.execute()) as MutationResult<I>;
          client.assertPersistenceActive();
          operation.commit(result);
          return { error: undefined, result };
        } catch (error) {
          operation.rollback();
          return handleMutationError(identifier.key, error);
        }
      };
      const mutationPromise = client.trackPendingRequest(performMutation);

      if (operation.entityId) {
        client.registerPendingOptimisticMutation(operation.entityId, mutationPromise);
      }

      return await mutationPromise;
    } finally {
      release?.();
    }
  }) as MutationFunction<I>;
}

const handleMutationError = (key: string, error: unknown): { error: Error; result: undefined } => {
  if (error instanceof Error) {
    const statusCode = getErrorStatusCode(error);
    const errorCategory = statusCode
      ? categorizeHTTPErrorStatus(statusCode)
      : error instanceof GraphQLRequestError && error.kind === 'execution' && error.errors.length
        ? 'callSite'
        : 'boundary';
    if (errorCategory === 'boundary') {
      throw error;
    }
    return { error, result: undefined };
  }
  throw new Error(`fate: Mutation '${key}' failed.`, { cause: error });
};

export type ErrorHandlingScope = 'callSite' | 'boundary';

const graphQLErrorStatuses = new Map<string, number>([
  ['BAD_REQUEST', 400],
  ['BAD_USER_INPUT', 400],
  ['GRAPHQL_PARSE_FAILED', 400],
  ['GRAPHQL_VALIDATION_FAILED', 400],
  ['VALIDATION_ERROR', 400],
  ['UNAUTHENTICATED', 401],
  ['UNAUTHORIZED', 401],
  ['FORBIDDEN', 403],
  ['NOT_FOUND', 404],
  ['TIMEOUT', 408],
  ['CONFLICT', 409],
  ['PRECONDITION_FAILED', 412],
  ['UNPROCESSABLE_CONTENT', 422],
  ['TOO_MANY_REQUESTS', 429],
  ['INTERNAL_ERROR', 500],
  ['INTERNAL_SERVER_ERROR', 500],
  ['NOT_IMPLEMENTED', 501],
  ['BAD_GATEWAY', 502],
  ['SERVICE_UNAVAILABLE', 503],
  ['GATEWAY_TIMEOUT', 504],
]);

const isErrorStatus = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599;

export const getErrorStatusCode = (error: Error): number | undefined => {
  if (error instanceof FateRequestError) {
    return error.status;
  }

  if (error instanceof GraphQLRequestError) {
    if (error.kind === 'protocol') {
      return undefined;
    }
    let statusCode = isErrorStatus(error.status) ? error.status : undefined;
    if (statusCode && categorizeHTTPErrorStatus(statusCode) === 'boundary') {
      return statusCode;
    }
    for (const { extensions } of error.errors) {
      const httpStatus = isRecord(extensions?.http) ? extensions.http.status : undefined;
      const codeStatus =
        typeof extensions?.code === 'string'
          ? graphQLErrorStatuses.get(extensions.code)
          : undefined;
      for (const status of [httpStatus, codeStatus]) {
        if (isErrorStatus(status)) {
          if (categorizeHTTPErrorStatus(status) === 'boundary') {
            return status;
          }
          statusCode ??= status;
        }
      }
    }
    return statusCode;
  }

  const { data } = error as { data?: unknown };
  if (!data || typeof data !== 'object') {
    return undefined;
  }

  return getHTTPStatusCodeFromError(data as TRPCError);
};

const categorizeHTTPErrorStatus = (statusCode: number): ErrorHandlingScope => {
  switch (statusCode) {
    case 400: // BAD_REQUEST
    case 402: // PAYMENT_REQUIRED
    case 404: // NOT_FOUND (resource-level)
    case 408: // TIMEOUT
    case 409: // CONFLICT
    case 412: // PRECONDITION_FAILED
    case 413: // PAYLOAD_TOO_LARGE
    case 415: // UNSUPPORTED_MEDIA_TYPE
    case 422: // UNPROCESSABLE_CONTENT
    case 429: // TOO_MANY_REQUESTS
    case 499: // CLIENT_CLOSED_REQUEST
      return 'callSite';

    case 401: // UNAUTHORIZED
    case 403: // FORBIDDEN
    case 405: // METHOD_NOT_SUPPORTED
    case 428: // PRECONDITION_REQUIRED
    case 500: // INTERNAL_SERVER_ERROR
    case 501: // NOT_IMPLEMENTED
    case 502: // BAD_GATEWAY
    case 503: // SERVICE_UNAVAILABLE
    case 504: // GATEWAY_TIMEOUT
    default:
      return 'boundary';
  }
};
