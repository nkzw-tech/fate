import type { AnyTRPCProcedure } from '@trpc/server';
import type { AnyRecord } from '../types.ts';
import type { SourceRegistry } from './executor.ts';
import { resolveSourceByIds, resolveSourceConnection } from './executor.ts';
import { byIdInput } from './input.ts';
import type { SourceDefinition } from './source.ts';

type ProcedureLike = {
  input: (schema: any) => {
    query: (resolver: (options: any) => unknown) => AnyTRPCProcedure;
  };
};

type ConnectionProcedureLike = (options: {
  defaultSize?: number;
  query: (options: {
    ctx: unknown;
    cursor?: string;
    direction: 'backward' | 'forward';
    input: {
      args?: Record<string, unknown>;
      select: Array<string>;
    };
    skip?: number;
    take: number;
  }) => Promise<Array<AnyRecord>>;
}) => AnyTRPCProcedure;

type ListConfig = {
  defaultSize?: number;
};

type SourceProcedureOptions<
  Context,
  Item extends AnyRecord,
  Procedure extends ProcedureLike = ProcedureLike,
  ConnectionProcedure extends ConnectionProcedureLike | undefined =
    | ConnectionProcedureLike
    | undefined,
> = {
  byId?: boolean;
  createConnectionProcedure?: ConnectionProcedure;
  list?: boolean | ListConfig;
  procedure: Procedure;
  registry: SourceRegistry<Context>;
  source: SourceDefinition<Item, unknown>;
};

type SourceProcedureFactoryOptions<
  Item extends AnyRecord,
  ById extends boolean | undefined = boolean | undefined,
  List extends boolean | ListConfig | undefined = boolean | ListConfig | undefined,
> = {
  byId?: ById;
  list?: List;
  source: SourceDefinition<Item, unknown>;
};

type SourceProcedureFactoryInput<
  Item extends AnyRecord,
  ById extends boolean | undefined = boolean | undefined,
  List extends boolean | ListConfig | undefined = boolean | ListConfig | undefined,
> = SourceDefinition<Item, unknown> | SourceProcedureFactoryOptions<Item, ById, List>;

type SourceProcedureFactoryDefaults<
  Context,
  Procedure extends ProcedureLike,
  ConnectionProcedure extends ConnectionProcedureLike | undefined,
> = {
  createConnectionProcedure?: ConnectionProcedure;
  procedure: Procedure;
  registry: SourceRegistry<Context>;
};

type ProcedureResult<Procedure extends ProcedureLike> = ReturnType<
  ReturnType<Procedure['input']>['query']
>;

type ConnectionProcedureResult<ConnectionProcedure extends ConnectionProcedureLike | undefined> =
  ConnectionProcedure extends ConnectionProcedureLike ? ReturnType<ConnectionProcedure> : never;

type SourceProcedureResult<
  ById extends boolean | undefined,
  List extends boolean | ListConfig | undefined,
  Procedure extends ProcedureLike,
  ConnectionProcedure extends ConnectionProcedureLike | undefined,
> = (ById extends false ? Record<never, never> : { byId: ProcedureResult<Procedure> }) &
  (List extends false
    ? Record<never, never>
    : { list: ConnectionProcedureResult<ConnectionProcedure> });

const normalizeSourceOptions = <
  Item extends AnyRecord,
  ById extends boolean | undefined,
  List extends boolean | ListConfig | undefined,
>(
  input: SourceProcedureFactoryInput<Item, ById, List>,
): SourceProcedureFactoryOptions<Item, ById, List> =>
  'source' in input ? input : { source: input };

/**
 * Creates standard `byId` and `list` procedures for a Fate source.
 *
 * Use this when a router also has custom mutations or custom queries and you
 * want to spread the generated source procedures into that router.
 */
export function createSourceProcedures<
  Context,
  Item extends AnyRecord,
  Procedure extends ProcedureLike,
  ConnectionProcedure extends ConnectionProcedureLike | undefined =
    | ConnectionProcedureLike
    | undefined,
  ById extends boolean | undefined = undefined,
  List extends boolean | ListConfig | undefined = undefined,
>({
  byId,
  createConnectionProcedure,
  list,
  procedure,
  registry,
  source,
}: SourceProcedureOptions<Context, Item, Procedure, ConnectionProcedure> & {
  byId?: ById;
  list?: List;
}): SourceProcedureResult<ById, List, Procedure, ConnectionProcedure> {
  const procedures: Record<string, any> = {};

  if (byId !== false) {
    procedures.byId = procedure.input(byIdInput).query(
      async ({
        ctx,
        input,
      }: {
        ctx: Context;
        input: {
          args?: Record<string, unknown>;
          ids: Array<string>;
          select: Array<string>;
        };
      }) =>
        resolveSourceByIds({
          ctx,
          ids: input.ids,
          input,
          registry,
          source,
        }),
    );
  }

  if (list !== false) {
    if (!createConnectionProcedure) {
      throw new Error(
        `Source ${source.view.typeName} requires createConnectionProcedure to build a list procedure.`,
      );
    }

    const listConfig = typeof list === 'object' ? list : undefined;
    procedures.list = createConnectionProcedure({
      defaultSize: listConfig?.defaultSize,
      query: async ({ ctx, cursor, direction, input, skip, take }) =>
        resolveSourceConnection({
          ctx: ctx as Context,
          cursor,
          direction,
          input,
          registry,
          skip,
          source,
          take,
        }),
    });
  }

  return procedures as SourceProcedureResult<ById, List, Procedure, ConnectionProcedure>;
}

/**
 * Binds the app-specific tRPC pieces once and returns a compact helper for
 * source procedures.
 */
export function bindSourceProcedures<
  Context,
  Procedure extends ProcedureLike,
  ConnectionProcedure extends ConnectionProcedureLike | undefined =
    | ConnectionProcedureLike
    | undefined,
>(defaults: SourceProcedureFactoryDefaults<Context, Procedure, ConnectionProcedure>) {
  return <
    Item extends AnyRecord,
    ById extends boolean | undefined = undefined,
    List extends boolean | ListConfig | undefined = undefined,
  >(
    input: SourceProcedureFactoryInput<Item, ById, List>,
  ) =>
    createSourceProcedures({
      ...defaults,
      ...normalizeSourceOptions(input),
    });
}
