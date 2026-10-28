import { type GraphQLErrorPayload, GraphQLRequestError } from './graphql-error.ts';
import { graphQLProtocolError, readGraphQLMultipart } from './graphqlMultipart.ts';
import { isRecord } from './record.ts';

type OperationResult = { alias: string; data: unknown; errors: ReadonlyArray<GraphQLErrorPayload> };
type PendingResult = OperationResult & { errors: Array<GraphQLErrorPayload>; received: boolean };

export async function readGraphQLIncremental(
  response: Response,
  aliases: ReadonlySet<string>,
  deliver: (result: OperationResult) => void,
  signal?: AbortSignal,
) {
  function invalid(message: string): never {
    throw graphQLProtocolError(message, response.status);
  }
  const record = (value: unknown) => {
    if (!isRecord(value)) {
      invalid('Invalid incremental response object.');
    }
    return value;
  };
  const array = (value: unknown): ReadonlyArray<unknown> => {
    if (value === undefined) {
      return [];
    }
    if (!Array.isArray(value)) {
      invalid('Invalid incremental response array.');
    }
    return value;
  };
  const string = (value: unknown) => {
    if (typeof value !== 'string') {
      invalid('Invalid incremental operation identifier.');
    }
    return value;
  };
  const errors = (value: unknown): Array<GraphQLErrorPayload> => {
    const entries = array(value);
    if (!entries.every(isRecord)) {
      invalid('Invalid incremental errors.');
    }
    return entries as Array<GraphQLErrorPayload>;
  };
  if (
    !/(?:^|;)\s*incrementalSpec\s*=\s*(?:"v0\.2"|v0\.2)(?:\s*;|\s*$)/i.test(
      response.headers.get('content-type') || '',
    )
  ) {
    invalid('Expected incrementalSpec=v0.2.');
  }
  const pending = new Map<string, PendingResult>();
  const pendingAliases = new Set<string>();
  const unfinished = new Set(aliases);
  let initial = true;
  for await (const payload of readGraphQLMultipart(response, signal)) {
    const frame = record(payload);
    if (typeof frame.hasNext !== 'boolean') {
      invalid('Missing incremental completion flag.');
    }
    const globalErrors = errors(frame.errors);
    if (globalErrors.length) {
      throw new GraphQLRequestError(globalErrors, { data: frame.data, status: response.status });
    }
    for (const value of array(frame.pending)) {
      const entry = record(value);
      const id = string(entry.id);
      const alias = string(entry.label);
      if (
        !Array.isArray(entry.path) ||
        entry.path.length ||
        !unfinished.has(alias) ||
        pending.has(id) ||
        pendingAliases.has(alias)
      ) {
        invalid('Invalid pending operation.');
      }
      pending.set(id, { alias, data: undefined, errors: [], received: false });
      pendingAliases.add(alias);
    }
    if (initial) {
      const data = record(frame.data);
      for (const alias of unfinished) {
        if (Object.hasOwn(data, alias)) {
          if (pendingAliases.has(alias)) {
            invalid('Operation is both pending and complete.');
          }
          deliver({ alias, data: data[alias], errors: [] });
          unfinished.delete(alias);
        }
      }
      initial = false;
    } else if (Object.hasOwn(frame, 'data')) {
      invalid('Unexpected incremental initial data.');
    }
    for (const value of array(frame.incremental)) {
      const part = record(value);
      const target = pending.get(string(part.id));
      if (
        !target ||
        (part.subPath !== undefined && (!Array.isArray(part.subPath) || part.subPath.length))
      ) {
        invalid('Unknown or nested incremental operation.');
      }
      target.errors.push(...errors(part.errors));
      if (part.data !== undefined) {
        const data = record(part.data);
        if (!Object.hasOwn(data, target.alias) || target.received) {
          invalid('Invalid incremental operation data.');
        }
        target.data = data[target.alias];
        target.received = true;
      }
    }
    for (const value of array(frame.completed)) {
      const entry = record(value);
      const id = string(entry.id);
      const target = pending.get(id);
      if (!target) {
        invalid('Unknown completed operation.');
      }
      target.errors.push(...errors(entry.errors));
      if (!target.received && !target.errors.length) {
        invalid('Completed operation is missing its result.');
      }
      deliver(target);
      unfinished.delete(target.alias);
      pendingAliases.delete(target.alias);
      pending.delete(id);
    }
    if (!frame.hasNext) {
      if (unfinished.size || pending.size) {
        invalid('Incremental response ended with unfinished operations.');
      }
      return;
    }
  }
  invalid('Incremental response ended before completion.');
}
