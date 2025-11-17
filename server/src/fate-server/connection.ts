import { z } from 'zod';
import type { AppContext } from '../trpc/context.ts';
import { procedure } from '../trpc/init.ts';

type ConnectionCursor = string;

const args: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.record(z.string(), z.union([z.unknown(), args])),
);

export const connectionArgs = args.optional();

const paginationArgKeys = new Set(['after', 'before', 'first', 'last']);

const paginationArgsSchema = z
  .object({
    after: z.string().optional(),
    before: z.string().optional(),
    first: z.number().int().positive().optional(),
    last: z.number().int().positive().optional(),
  })
  .strict()
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
): Record<string, unknown> => {
  if (!args) {
    return {};
  }

  const entries = Object.entries(args).filter(([key]) =>
    paginationArgKeys.has(key),
  );

  return Object.fromEntries(entries);
};

export const connectionInput = z
  .object({
    args: connectionArgs,
    select: z.array(z.string()),
  })
  .strict();

export type ConnectionInput = z.infer<typeof connectionInput>;

export type ConnectionItem<TNode> = {
  cursor: ConnectionCursor;
  node: TNode;
};

export type ConnectionPagination = {
  hasNext: boolean;
  hasPrevious: boolean;
  nextCursor?: ConnectionCursor;
  previousCursor?: ConnectionCursor;
};

export type ConnectionResult<TNode> = {
  items: Array<ConnectionItem<TNode>>;
  pagination: ConnectionPagination;
};

type ArrayToConnectionOptions<TNode> = {
  args?: Record<string, unknown>;
  getCursor?: (node: TNode) => ConnectionCursor;
};

export function arrayToConnection<TNode extends { id: string | number }>(
  nodes?: Array<TNode>,
  options: ArrayToConnectionOptions<TNode> = {},
): ConnectionResult<TNode> | undefined {
  if (!nodes) {
    return undefined;
  }

  const {
    args,
    getCursor = (node: TNode) => String((node as { id: string | number }).id),
  } = options;
  const paginationArgs = paginationArgsSchema.parse(
    extractPaginationArgs(args),
  );

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
    } satisfies ConnectionResult<TNode>;
  }

  const isBackward =
    paginationArgs.before !== undefined || paginationArgs.last !== undefined;
  const cursor = isBackward ? paginationArgs.before : paginationArgs.after;
  const pageSize = paginationArgs.first ?? paginationArgs.last ?? nodes.length;
  const hasMore = nodes.length > pageSize;
  const limitedNodes = isBackward
    ? nodes.slice(Math.max(0, nodes.length - pageSize))
    : nodes.slice(0, pageSize);
  const items = limitedNodes.map((node) => ({
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
      previousCursor:
        (isBackward ? hasMore : Boolean(cursor)) && firstItem
          ? firstItem.cursor
          : undefined,
    },
  } satisfies ConnectionResult<TNode>;
}

type QueryFn<TItem> = (options: {
  ctx: AppContext;
  cursor?: ConnectionCursor;
  direction: 'forward' | 'backward';
  input: ConnectionInput;
  skip?: number;
  take: number;
}) => Promise<Array<TItem>>;

type MapFn<TItem, TNode> = (options: {
  ctx: AppContext;
  input: ConnectionInput;
  items: Array<TItem>;
}) => Promise<Array<TNode>> | Array<TNode>;

type CreateConnectionProcedureOptions<TItem, TNode> = {
  defaultSize?: number;
  getCursor?: (node: TNode) => ConnectionCursor;
  map?: MapFn<TItem, TNode>;
  query: QueryFn<TItem>;
};

export const createConnectionProcedure = <TItem, TNode = TItem>(
  options: CreateConnectionProcedureOptions<TItem, TNode>,
) => {
  const {
    defaultSize = 20,
    getCursor = (node: TNode) => (node as { id: string }).id,
    map,
    query,
  } = options;

  return procedure.input(connectionInput).query(async ({ ctx, input }) => {
    const paginationArgs = paginationArgsSchema.parse(
      extractPaginationArgs(input.args),
    );
    const isBackward =
      paginationArgs.before !== undefined || paginationArgs.last !== undefined;
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
        previousCursor: (isBackward ? hasMore : Boolean(cursor))
          ? firstItem?.cursor
          : undefined,
      },
    } satisfies ConnectionResult<TNode>;
  });
};
