import { z } from 'zod';
import type { AppContext } from '../trpc/context.ts';
import { procedure } from '../trpc/init.ts';

type ConnectionCursor = string;

export const connectionInput = z
  .object({
    after: z.string().optional(),
    first: z.number().int().positive().optional(),
    select: z.array(z.string()).optional(),
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

type QueryFn<TRow> = (options: {
  ctx: AppContext;
  cursor?: ConnectionCursor;
  input: ConnectionInput;
  skip?: number;
  take: number;
}) => Promise<Array<TRow>>;

type MapFn<TRow, TNode> = (options: {
  ctx: AppContext;
  input: ConnectionInput;
  rows: Array<TRow>;
}) => Promise<Array<TNode>> | Array<TNode>;

type CreateConnectionProcedureOptions<TRow, TNode> = {
  defaultSize?: number;
  getCursor?: (node: TNode) => ConnectionCursor;
  map?: MapFn<TRow, TNode>;
  query: QueryFn<TRow>;
};

export const createConnectionProcedure = <TRow, TNode = TRow>(
  options: CreateConnectionProcedureOptions<TRow, TNode>,
) => {
  const {
    defaultSize = 20,
    getCursor = (node: TNode) => (node as { id: string }).id,
    map,
    query,
  } = options;

  return procedure.input(connectionInput).query(async ({ ctx, input }) => {
    const pageSize = input.first ?? defaultSize;
    const rows = await query({
      ctx,
      cursor: input.after,
      input,
      skip: input.after ? 1 : undefined,
      take: pageSize + 1,
    });

    const hasNext = rows.length > pageSize;
    const limitedRows = rows.slice(0, pageSize);
    const nodes = map
      ? await map({ ctx, input, rows: limitedRows })
      : (limitedRows as unknown as Array<TNode>);

    const items = nodes.map((node) => ({
      cursor: getCursor(node),
      node,
    }));
    const lastItem = items.at(-1);

    return {
      items,
      pagination: {
        hasNext,
        hasPrevious: Boolean(input.after),
        nextCursor: lastItem?.cursor,
        previousCursor: input.after,
      },
    } satisfies ConnectionResult<TNode>;
  });
};
