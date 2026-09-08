import type { TRPCError } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import type { FateClient } from './client.js';
import type { MutationIdentity } from './persistence-types.ts';
import { FateRequestError } from './protocol.ts';
import { toEntityId } from './ref.ts';
import { getSelectionPlan, type SelectionPlan } from './selection.ts';
import type {
  AnyRecord,
  Entity,
  MutationDefinition,
  MutationEntity,
  MutationIdentifier,
  MutationInput,
  MutationResult,
  OptimisticUpdate,
  Selection,
  TypeConfig,
  View,
} from './types.ts';
import { MutationKind } from './types.ts';

/**
 * Defines a mutation for a given entity type, preserving the input and output
 * types for transports.
 */
export function mutation<T extends Entity, I, R>(
  entity: T['__typename'],
): MutationDefinition<T, I, R> {
  return Object.freeze({
    entity,
    [MutationKind]: true,
  }) as MutationDefinition<T, I, R>;
}

/** Where (or if) to insert the resulting record into relevant lists. */
export type InsertPosition = 'after' | 'before' | 'none';
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
  insert?: InsertPosition;
  /** Optional optimistic update to apply immediately. */
  optimistic?: OptimisticUpdate<MutationResult<Identifier>>;
  /** Skip durable delivery for this call, even when persistence is configured. */
  persist?: boolean;
  /** Optional view specifying which fields to select from the server. */
  view?: View<MutationEntity<Identifier>, Selection<MutationEntity<Identifier>>>;
};

/**
 * Callable mutation entry point returned on the client that resolves to either
 * a successful result or an error.
 */
export type MutationFunction<I extends MutationIdentifier<any, any, any>> = (
  options: MutationOptions<I>,
) => Promise<{ error: undefined; result: MutationResult<I> } | { error: Error; result: undefined }>;

/**
 * React action-compatible wrapper that can be passed directly to form actions
 * or transitions.
 */
export type MutationAction<I extends MutationIdentifier<any, any, any>> = (
  previousState: unknown,
  /**
   * Mutation options or 'reset' to reset the action state.
   */
  options: MutationOptions<I> | 'reset',
) => Promise<{ error: undefined; result: MutationResult<I> } | { error: Error; result: undefined }>;

type MutationIdentifierFor<K extends string, Def extends MutationDefinition<any, any, any>> =
  Def extends MutationDefinition<infer T, infer I, infer R>
    ? MutationIdentifier<T, I, R> & Readonly<{ key: K }>
    : never;

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
  insert: InsertPosition;
  key: string;
  optimistic?: AnyRecord;
  plan?: SelectionPlan;
};

/** @internal Creates the same optimistic/confirmation machinery for live and restored calls. */
export function prepareMutation(
  client: FateClient<any, any>,
  command: MutationCommand,
  config: TypeConfig,
  durable = false,
) {
  const { args, delete: deleteRecord, entity, input, insert, key, optimistic, plan } = command;
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
  const settle = client.store.optimisticUpdate(() => {
    if (optimisticRecord && optimisticEntityId) {
      client.write(entity, optimisticRecord, optimisticSelection ?? emptySet, plan, insert);
    }
    if (deleteRecord && id != null) {
      client.deleteRecord(entity, id);
    }
  }, durable);
  return {
    commit: (result: unknown) =>
      settle(() => {
        if (result && typeof result === 'object' && (!deleteRecord || plan)) {
          client.write(
            entity,
            result as AnyRecord,
            collectImplicitSelectedPaths(result as AnyRecord),
            plan,
            insert,
          );
          const resultId = maybeGetId(config.getId, result as AnyRecord);
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
      }),
    entityId: optimisticEntityId,
    execute: (identity?: MutationIdentity) =>
      client.executeMutation(key, input, selection, { args, identity, plan }),
    rollback: () => settle(),
  };
}

/** Binds a mutation's optimistic updates, cache writes, and error handling. */
export function wrapMutation<
  I extends MutationIdentifier<any, any, any>,
  M extends Record<string, MutationDefinition<any, any, any>>,
>(client: FateClient<any, M>, identifier: I): MutationFunction<I> {
  const config = client.getTypeConfig(identifier.entity);

  return async ({
    args,
    delete: deleteRecord,
    input,
    insert = 'after',
    optimistic,
    persist,
    view,
  }: MutationOptions<I>) => {
    const command: MutationCommand = {
      args,
      delete: deleteRecord,
      entity: identifier.entity,
      input,
      insert,
      key: identifier.key,
      optimistic: optimistic as AnyRecord | undefined,
      plan: view ? getSelectionPlan(view, null) : undefined,
    };
    if (client.persistence && persist !== false) {
      try {
        const result = (await client.withPersistenceLifecycle(() =>
          client.persistence!.mutate(command),
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

    return mutationPromise;
  };
}

const handleMutationError = (key: string, error: unknown): { error: Error; result: undefined } => {
  if (error instanceof Error) {
    const statusCode = getErrorStatusCode(error);
    const errorCategory = statusCode ? categorizeHTTPErrorStatus(statusCode) : 'boundary';
    if (errorCategory === 'boundary') {
      throw error;
    }
    return { error, result: undefined };
  }
  throw new Error(`fate: Mutation '${key}' failed.`, { cause: error });
};

export type ErrorHandlingScope = 'callSite' | 'boundary';

export const getErrorStatusCode = (error: Error): number | undefined => {
  if (error instanceof FateRequestError) {
    return error.status;
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
