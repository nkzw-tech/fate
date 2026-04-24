import { tracked, type AnyTRPCProcedure } from '@trpc/server';
import type { AnyRecord } from '../types.ts';
import type { SourceRegistry } from './executor.ts';
import { resolveSourceById, resolveSourceByIds, resolveSourceConnection } from './executor.ts';
import { byIdInput, liveByIdInput } from './input.ts';
import type { LiveEventBus, LiveSourceEvent } from './live.ts';
import type { SourceDefinition } from './source.ts';

type ProcedureLike = {
  input: (schema: any) => {
    query: (resolver: (options: any) => unknown) => AnyTRPCProcedure;
    subscription: (resolver: (options: any) => unknown) => AnyTRPCProcedure;
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

type LiveConfig =
  | LiveEventBus
  | {
      bus: LiveEventBus;
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
  live?: false | LiveConfig;
  procedure: Procedure;
  registry: SourceRegistry<Context>;
  source: SourceDefinition<Item, unknown>;
};

type SourceProcedureFactoryOptions<
  Item extends AnyRecord,
  ById extends boolean | undefined = boolean | undefined,
  List extends boolean | ListConfig | undefined = boolean | ListConfig | undefined,
  Live extends false | LiveConfig | undefined = false | LiveConfig | undefined,
> = {
  byId?: ById;
  list?: List;
  live?: Live;
  source: SourceDefinition<Item, unknown>;
};

type SourceProcedureFactoryInput<
  Item extends AnyRecord,
  ById extends boolean | undefined = boolean | undefined,
  List extends boolean | ListConfig | undefined = boolean | ListConfig | undefined,
  Live extends false | LiveConfig | undefined = false | LiveConfig | undefined,
> = SourceDefinition<Item, unknown> | SourceProcedureFactoryOptions<Item, ById, List, Live>;

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

type SubscriptionProcedureResult<Procedure extends ProcedureLike> = ReturnType<
  ReturnType<Procedure['input']>['subscription']
>;

type ConnectionProcedureResult<ConnectionProcedure extends ConnectionProcedureLike | undefined> =
  ConnectionProcedure extends ConnectionProcedureLike ? ReturnType<ConnectionProcedure> : never;

type SourceProcedureResult<
  ById extends boolean | undefined,
  List extends boolean | ListConfig | undefined,
  Live extends false | LiveConfig | undefined,
  Procedure extends ProcedureLike,
  ConnectionProcedure extends ConnectionProcedureLike | undefined,
> = (ById extends false ? Record<never, never> : { byId: ProcedureResult<Procedure> }) &
  (List extends false
    ? Record<never, never>
    : { list: ConnectionProcedureResult<ConnectionProcedure> }) &
  (Live extends LiveConfig
    ? { live: SubscriptionProcedureResult<Procedure> }
    : Record<never, never>);

const normalizeSourceOptions = <
  Item extends AnyRecord,
  ById extends boolean | undefined,
  List extends boolean | ListConfig | undefined,
  Live extends false | LiveConfig | undefined,
>(
  input: SourceProcedureFactoryInput<Item, ById, List, Live>,
): SourceProcedureFactoryOptions<Item, ById, List, Live> =>
  'source' in input ? input : { source: input };

const livePayload = (event: LiveSourceEvent, data: unknown) => {
  const payload =
    event.type === 'delete' || data == null ? { delete: true, id: event.id } : { data };
  return event.eventId ? tracked(event.eventId, payload) : payload;
};

const getLiveBus = (live: false | LiveConfig | undefined): LiveEventBus | null => {
  if (!live) {
    return null;
  }

  if ('subscribe' in live) {
    return live;
  }

  return live.bus;
};

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
  Live extends false | LiveConfig | undefined = undefined,
>({
  byId,
  createConnectionProcedure,
  list,
  live,
  procedure,
  registry,
  source,
}: SourceProcedureOptions<Context, Item, Procedure, ConnectionProcedure> & {
  byId?: ById;
  list?: List;
  live?: Live;
}): SourceProcedureResult<ById, List, Live, Procedure, ConnectionProcedure> {
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

  const liveBus = getLiveBus(live);
  if (liveBus) {
    procedures.live = procedure.input(liveByIdInput).subscription(async function* ({
      ctx,
      input,
      signal,
    }: {
      ctx: Context;
      input: {
        args?: Record<string, unknown>;
        id: string;
        select: Array<string>;
      };
      signal?: AbortSignal;
    }) {
      const iterable = liveBus.subscribe(source.view.typeName, input.id, { signal });

      for await (const [event] of iterable) {
        const data =
          event.type === 'delete'
            ? null
            : await resolveSourceById({
                ctx,
                id: String(event.id),
                input: {
                  args: input.args,
                  select: input.select,
                },
                registry,
                source,
              });

        yield livePayload(event, data);
      }
    });
  }

  return procedures as SourceProcedureResult<ById, List, Live, Procedure, ConnectionProcedure>;
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
    Live extends false | LiveConfig | undefined = undefined,
  >(
    input: SourceProcedureFactoryInput<Item, ById, List, Live>,
  ) =>
    createSourceProcedures({
      ...defaults,
      ...normalizeSourceOptions(input),
    });
}
