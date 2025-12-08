import type { TRPCProcedureBuilder } from '@trpc/server';
import { z } from 'zod';
import type { DataView } from './dataView.ts';
import { isRecord } from '../record.ts';
import { getScopedArgs } from './prismaSelect.ts';

type ConnectionInput = z.infer<typeof connectionInput>;

type AdditionalInputSchema = z.ZodObject<Record<string, z.ZodTypeAny>>;

type ConnectionInputWithAdditional<TAdditionalInput extends AdditionalInputSchema | undefined> =
  ConnectionInput & {
    args?: ConnectionInput['args'] extends infer A
      ? A & (TAdditionalInput extends AdditionalInputSchema ? z.infer<TAdditionalInput> : object)
      : never;
  };

type ConnectionCursor = string;

/**
 * Connection item including the node and opaque cursor.
 */
export type ConnectionItem<TNode> = {
  cursor: ConnectionCursor;
  node: TNode;
};

/**
 * Pagination metadata returned with connection lists.
 */
export type ConnectionPagination = {
  hasNext: boolean;
  hasPrevious: boolean;
  nextCursor?: ConnectionCursor;
  previousCursor?: ConnectionCursor;
};

/**
 * Connection payload that mirrors what the client expects for list fields.
 */
export type ConnectionResult<TNode> = {
  items: Array<ConnectionItem<TNode>>;
  pagination: ConnectionPagination;
};

type AnyRecord = Record<string, unknown>;

type ArrayToConnectionOptions<TNode> = {
  args?: Record<string, unknown>;
  getCursor?: (node: TNode) => ConnectionCursor;
};

type ProcedureLike<TContext> = TRPCProcedureBuilder<TContext, any, any, any, any, any, any, false>;

type QueryFn<TContext, TItem, TInput extends ConnectionInput> = (options: {
  ctx: TContext;
  cursor?: ConnectionCursor;
  direction: 'forward' | 'backward';
  input: TInput;
  skip?: number;
  take: number;
}) => Promise<Array<TItem>>;

type MapFn<TContext, TItem, TNode, TInput extends ConnectionInput> = (options: {
  ctx: TContext;
  input: TInput;
  items: Array<TItem>;
}) => Promise<Array<TNode>> | Array<TNode>;

const args: z.ZodType<Record<string, unknown>> = z
  .object({})
  .catchall(z.union([z.unknown(), z.lazy(() => args)]));

/**
 * Zod schema for connection args (`after`, `before`, `first`, `last`, etc.).
 */
export const connectionArgs = args.optional();

const connectionInput = z.strictObject({
  args: connectionArgs,
  select: z.array(z.string()),
});

const paginationArgKeys = new Set(['after', 'before', 'first', 'last']);

const paginationArgsSchema = z
  .strictObject({
    after: z.string().optional(),
    before: z.string().optional(),
    first: z.number().int().positive().optional(),
    last: z.number().int().positive().optional(),
  })
  .partial()
  .refine(
    ({ after, before }) => !(after && before),
    "Connection args can't include both 'after' and 'before'.",
  )
  .refine(
    ({ first, last }) => !(first && last),
    "Connection args can't include both 'first' and 'last'.",
  )
  .refine(
    ({ before, last }) => !last || before !== undefined,
    "Connection args using 'last' must also include 'before'.",
  );

const extractPaginationArgs = (
  args: Record<string, unknown> | undefined,
): Record<string, unknown> =>
  args
    ? Object.fromEntries(Object.entries(args).filter(([key]) => paginationArgKeys.has(key)))
    : {};

/**
 * Converts an array of nodes into a list view connection result the client
 * can normalize.
 */
export function arrayToConnection<TNode extends { id: string | number }>(
  nodes?: Array<TNode>,
  {
    args,
    getCursor = (node: TNode) => String((node as { id: string | number }).id),
  }: ArrayToConnectionOptions<TNode> = {},
): ConnectionResult<TNode> | undefined {
  if (!nodes) {
    return undefined;
  }

  const paginationArgs = paginationArgsSchema.parse(extractPaginationArgs(args));

  if (Object.keys(paginationArgs).length === 0) {
    return {
      items: nodes.map((node) => ({
        cursor: getCursor(node),
        node,
      })),
      pagination: {
        hasNext: false,
        hasPrevious: false,
        nextCursor: undefined,
        previousCursor: undefined,
      },
    };
  }

  const isBackward = paginationArgs.before !== undefined || paginationArgs.last !== undefined;
  const cursor = isBackward ? paginationArgs.before : paginationArgs.after;
  const pageSize = paginationArgs.first ?? paginationArgs.last ?? nodes.length;
  const cursorIndex =
    cursor === undefined ? -1 : nodes.findIndex((node) => getCursor(node) === cursor);

  const selectedNodes =
    cursorIndex < 0
      ? nodes
      : isBackward
        ? nodes.slice(0, cursorIndex)
        : nodes.slice(cursorIndex + 1);
  const hasNext = selectedNodes.length > pageSize;
  const hasPrevious = nodes.length > selectedNodes.length;

  const items = (
    isBackward
      ? selectedNodes.slice(Math.max(0, selectedNodes.length - pageSize))
      : selectedNodes.slice(0, pageSize)
  ).map((node) => ({ cursor: getCursor(node), node }));
  const firstItem = items[0];
  const lastItem = items.at(-1);

  return {
    items,
    pagination: {
      hasNext: isBackward ? hasPrevious : hasNext,
      hasPrevious: isBackward ? hasNext : hasPrevious,
      nextCursor: lastItem?.cursor,
      previousCursor:
        (isBackward ? hasNext : hasPrevious) && firstItem ? firstItem.cursor : undefined,
    },
  };
}

const isDataViewField = (field: unknown): field is DataView<AnyRecord> =>
  Boolean(field) && typeof field === 'object' && 'fields' in (field as AnyRecord);

const assignIfChanged = <Value>(
  current: AnyRecord | null,
  key: string,
  next: Value,
  existing: Value | Array<unknown>,
): AnyRecord | null => {
  if (next === existing) {
    return current;
  }

  if (!current) {
    return { [key]: next } as AnyRecord;
  }

  current[key] = next;
  return current;
};

export function toConnectionResult<Item extends AnyRecord>({
  args,
  item,
  path,
  view,
}: {
  args?: Record<string, unknown>;
  item: Item;
  path?: string;
  view: DataView<Item>;
}): Item {
  if (!isRecord(item)) {
    return item;
  }

  let result: AnyRecord | null = null;

  const base = () => (result ? { ...item, ...result } : item);

  for (const [field, config] of Object.entries(view.fields)) {
    if (!isDataViewField(config)) {
      continue;
    }

    const current = base()[field];
    const nextPath = path ? `${path}.${field}` : field;

    if (config.kind === 'list') {
      if (!Array.isArray(current)) {
        continue;
      }

      const wrappedItems = current.map((item) =>
        toConnectionResult({
          args,
          item,
          path: nextPath,
          view: config,
        }),
      );
      const connection = arrayToConnection(wrappedItems, {
        args: getScopedArgs(args, nextPath),
      });
      result = assignIfChanged(result, field, connection, current);
      continue;
    }

    if (Array.isArray(current)) {
      const wrapped = current.map((entry) =>
        toConnectionResult({ args, item: entry as AnyRecord, path: nextPath, view: config }),
      );
      result = assignIfChanged(result, field, wrapped, current);
      continue;
    }

    if (isRecord(current)) {
      const wrapped = toConnectionResult({ args, item: current, path: nextPath, view: config });
      result = assignIfChanged(result, field, wrapped, current);
    }
  }

  return (result ? { ...item, ...result } : item) as Item;
}

/**
 * Wraps a tRPC procedure to handle cursor-based pagination with consistent
 * connection semantics.
 */
export const withConnection =
  <TContext>(procedure: ProcedureLike<TContext>) =>
  <TItem, TNode = TItem, TAdditionalInput extends AdditionalInputSchema | undefined = undefined>({
    defaultSize = 20,
    getCursor = (node: TNode) => (node as { id: string }).id,
    input: additionalInput,
    map,
    query,
  }: {
    defaultSize?: number;
    getCursor?: (node: TNode) => ConnectionCursor;
    input?: TAdditionalInput;
    map?: MapFn<TContext, TItem, TNode, ConnectionInputWithAdditional<TAdditionalInput>>;
    query: QueryFn<TContext, TItem, ConnectionInputWithAdditional<TAdditionalInput>>;
  }) => {
    type Input = ConnectionInputWithAdditional<TAdditionalInput>;

    const inputSchema = additionalInput
      ? connectionInput.extend({
          args: connectionArgs.and(additionalInput),
        })
      : connectionInput;

    return procedure.input(inputSchema).query(async (resolverOptions: unknown) => {
      const { ctx, input } = resolverOptions as {
        ctx: TContext;
        input: Input;
      };

      const paginationArgs = paginationArgsSchema.parse(extractPaginationArgs(input.args));
      const isBackward = paginationArgs.before !== undefined || paginationArgs.last !== undefined;
      const cursor = isBackward ? paginationArgs.before : paginationArgs.after;
      const direction = isBackward ? 'backward' : 'forward';
      const pageSize = paginationArgs.first ?? paginationArgs.last ?? defaultSize;
      const rawItems = await query({
        ctx,
        cursor,
        direction,
        input,
        skip: cursor ? 1 : undefined,
        take: pageSize + 1,
      });

      const hasMore = rawItems.length > pageSize;
      const limitedItems = isBackward
        ? rawItems.slice(Math.max(0, rawItems.length - pageSize))
        : rawItems.slice(0, pageSize);
      const nodes = map
        ? await map({ ctx, input, items: limitedItems })
        : (limitedItems as unknown as Array<TNode>);

      const items = nodes.map((node) => ({
        cursor: getCursor(node),
        node,
      }));
      const firstItem = items[0];
      const lastItem = items.at(-1);

      return {
        items,
        pagination: {
          hasNext: isBackward ? Boolean(cursor) : hasMore,
          hasPrevious: isBackward ? hasMore : Boolean(cursor),
          nextCursor: lastItem?.cursor,
          previousCursor: (isBackward ? hasMore : Boolean(cursor)) ? firstItem?.cursor : undefined,
        },
      } satisfies ConnectionResult<TNode>;
    }) as ReturnType<ReturnType<ProcedureLike<TContext>['input']>['query']>;
  };
