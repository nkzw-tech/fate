import type { ExecutionPlanNode, SourceOrder } from '@nkzw/fate/server';

const toPrismaOrderBy = (orderBy: SourceOrder) =>
  orderBy.map((entry) => ({ [entry.field]: entry.direction }));

export const prismaConnectionArgs = ({
  cursor,
  direction,
  node,
  skip,
  take,
}: {
  cursor?: string;
  direction: 'backward' | 'forward';
  node: ExecutionPlanNode<unknown>;
  skip?: number;
  take: number;
}) => ({
  ...(cursor
    ? {
        cursor: { id: cursor },
        skip,
      }
    : null),
  orderBy: toPrismaOrderBy(node.orderBy),
  take: direction === 'forward' ? take : -take,
});
