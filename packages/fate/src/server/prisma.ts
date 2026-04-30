/**
 * Fate's Prisma integration.
 *
 * @example
 * import { createPrismaFate } from '@nkzw/fate/server/prisma';
 *
 * @module @nkzw/fate/server/prisma
 */

import { isRecord } from '../record.ts';
import type { AnyRecord } from '../types.ts';
import { withConnection } from './connection.ts';
import { attachComputedState, isDataView, type DataView } from './dataView.ts';
import {
  createSourceRegistry,
  resolveSourceById,
  resolveSourceByIds,
  resolveSourceConnection,
  type SourceRegistry,
} from './executor.ts';
import { toPrismaSelect } from './prismaSelect.ts';
import {
  collectDataViewConfigs,
  createSourcePlan,
  createSourceDefinitions,
  getDataViewSourceConfig,
  type DataViewModule,
  type SourceConfig,
  type SourcePlan,
  type SourcePlanNode,
  type SourceDefinition,
  type SourceOrder,
  type SourceRelationConfig,
} from './source.ts';
import { bindSourceProcedures } from './sourceRouter.ts';

type Source = SourceDefinition<AnyRecord, unknown>;

export type PrismaDelegate = {
  findMany?: (args: any) => Promise<Array<AnyRecord>>;
  findUnique?: (args: any) => Promise<AnyRecord | null>;
  groupBy?: (args: any) => Promise<Array<AnyRecord>>;
};

export type PrismaQueryExtra = AnyRecord;

export type PrismaViewConfig<Context, Item extends AnyRecord = AnyRecord> = {
  delegate: (ctx: Context) => unknown;
} & SourceConfig<Item, unknown>;

type PrismaViewsInput<Context> =
  | Array<DataView<AnyRecord> | PrismaViewConfig<Context, AnyRecord>>
  | DataViewModule;

type PrismaSourceAdapterOptions<Context> = {
  prisma?: (ctx: Context) => unknown;
  views: PrismaViewsInput<Context>;
};

type SourceTarget<Item extends AnyRecord = AnyRecord> =
  | DataView<Item>
  | SourceDefinition<Item, unknown>;
type ViewTarget<Item extends AnyRecord = AnyRecord> = DataView<Item>;

type ListConfig = {
  defaultSize?: number;
};

type ViewProcedureInput<
  Item extends AnyRecord,
  ById extends boolean | undefined,
  List extends boolean | ListConfig | undefined,
> =
  | ViewTarget<Item>
  | {
      byId?: ById;
      list?: List;
      view: ViewTarget<Item>;
    };

export type PrismaSourceAdapter<Context> = {
  fetchById: <Item extends AnyRecord = AnyRecord>({
    ctx,
    extra,
    id,
    plan,
  }: {
    ctx: Context;
    extra?: PrismaQueryExtra;
    id: string;
    plan: SourcePlan<Item, Context>;
  }) => Promise<Item | null>;
  fetchByIds: <Item extends AnyRecord = AnyRecord>({
    ctx,
    extra,
    ids,
    plan,
  }: {
    ctx: Context;
    extra?: PrismaQueryExtra;
    ids: Array<string>;
    plan: SourcePlan<Item, Context>;
  }) => Promise<Array<Item>>;
  fetchConnection: <Item extends AnyRecord = AnyRecord>({
    ctx,
    cursor,
    direction,
    extra,
    plan,
    skip,
    take,
  }: {
    ctx: Context;
    cursor?: string;
    direction: 'backward' | 'forward';
    extra?: PrismaQueryExtra;
    plan: SourcePlan<Item, Context>;
    skip?: number;
    take: number;
  }) => Promise<Array<Item>>;
  getSource: <Item extends AnyRecord = AnyRecord>(
    target: SourceTarget<Item>,
  ) => SourceDefinition<Item, unknown>;
  registry: SourceRegistry<Context>;
  resolveById: <Item extends AnyRecord = AnyRecord>(options: {
    ctx: Context;
    extra?: PrismaQueryExtra;
    id: string;
    input: SourceInput;
    view: ViewTarget<Item>;
  }) => Promise<AnyRecord | null>;
  resolveByIds: <Item extends AnyRecord = AnyRecord>(options: {
    ctx: Context;
    extra?: PrismaQueryExtra;
    ids: Array<string>;
    input: SourceInput;
    view: ViewTarget<Item>;
  }) => Promise<Array<AnyRecord>>;
  resolveConnection: <Item extends AnyRecord = AnyRecord>(options: {
    ctx: Context;
    cursor?: string;
    direction: 'backward' | 'forward';
    extra?: PrismaQueryExtra;
    input: SourceInput;
    skip?: number;
    take: number;
    view: ViewTarget<Item>;
  }) => Promise<Array<AnyRecord>>;
};

type ProcedureLike = {
  input: (schema: any) => {
    query: (resolver: (options: any) => unknown) => any;
  };
};

type SourceInput = {
  args?: Record<string, unknown>;
  select: Iterable<string>;
};

const lowerFirst = (value: string) => `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;

const isPrismaViewConfig = <Context>(
  value: unknown,
): value is PrismaViewConfig<Context, AnyRecord> =>
  isRecord(value) && isDataView(value.view) && typeof value.delegate === 'function';

const getPrismaClient = <Context>({
  ctx,
  prisma,
}: {
  ctx: Context;
  prisma?: (ctx: Context) => unknown;
}) => {
  if (prisma) {
    return prisma(ctx);
  }

  return isRecord(ctx) && isRecord(ctx.prisma) ? ctx.prisma : ctx;
};

const createPrismaDelegate = <Context>(
  view: DataView<AnyRecord>,
  prisma?: (ctx: Context) => unknown,
) => {
  const delegateName = lowerFirst(view.typeName);

  return (ctx: Context) => {
    const client = getPrismaClient({ ctx, prisma });
    if (!isRecord(client)) {
      throw new Error(
        `Prisma client for ${view.typeName} could not be inferred. Pass 'prisma' to createPrismaFate.`,
      );
    }

    const delegate = client[delegateName];
    if (!delegate) {
      throw new Error(`Prisma delegate '${delegateName}' for ${view.typeName} was not found.`);
    }

    return delegate;
  };
};

const createPrismaViewConfigs = <Context>({
  prisma,
  views,
}: PrismaSourceAdapterOptions<Context>): Array<PrismaViewConfig<Context, AnyRecord>> =>
  Array.isArray(views)
    ? views.map((view) => {
        if (isPrismaViewConfig<Context>(view)) {
          return view;
        }

        if (!isDataView(view)) {
          throw new Error(`Expected a data view or Prisma view config.`);
        }

        const config = getDataViewSourceConfig(view);

        return {
          ...config,
          delegate: createPrismaDelegate(config.view, prisma),
        };
      })
    : collectDataViewConfigs(views).map((config) => ({
        ...config,
        delegate: createPrismaDelegate(config.view, prisma),
      }));

const inferPrismaRelation = ({
  field,
  kind,
  source,
  target,
}: {
  field: string;
  kind: 'many' | 'one';
  source: SourceDefinition<AnyRecord, unknown>;
  target: SourceDefinition<AnyRecord, unknown>;
}): SourceRelationConfig => {
  if (kind === 'one') {
    return {
      foreignKey: target.id,
      localKey: `${field}Id`,
    };
  }

  return {
    foreignKey: `${lowerFirst(source.view.typeName)}Id`,
    localKey: source.id,
  };
};

type CountRequest = {
  field: string;
  needName: string;
  relation: string;
  where?: unknown;
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

const resolveSourceReference = (source: Source | (() => Source)) =>
  typeof source === 'function' ? source() : source;

const isSourceDefinition = <Item extends AnyRecord>(
  target: SourceTarget<Item>,
): target is SourceDefinition<Item, unknown> => 'view' in target && 'id' in target;

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
  node: SourcePlanNode<any, any>;
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

const getConflictingCountRequests = <Context>(
  node: SourcePlanNode<Context>,
): Map<string, Array<CountRequest>> => {
  const signaturesByRelation = new Map<string, Set<string>>();
  const requestsByRelation = new Map<string, Array<CountRequest>>();

  for (const [field, computed] of node.computeds) {
    if (!computed.select) {
      continue;
    }

    for (const [selectionName, selection] of Object.entries(computed.select)) {
      if (selection.kind !== 'count') {
        continue;
      }

      const signature = stableStringify(selection.where ?? null);
      const signatures = signaturesByRelation.get(selection.relation) ?? new Set<string>();
      signatures.add(signature);
      signaturesByRelation.set(selection.relation, signatures);

      const requests = requestsByRelation.get(selection.relation) ?? [];
      requests.push({
        field,
        needName: selectionName,
        relation: selection.relation,
        where: selection.where,
      });
      requestsByRelation.set(selection.relation, requests);
    }
  }

  return new Map(
    [...requestsByRelation.entries()].filter(
      ([relation]) => (signaturesByRelation.get(relation)?.size ?? 0) > 1,
    ),
  );
};

export function createPrismaSourceAdapter<Context>({
  prisma,
  views,
}: PrismaSourceAdapterOptions<Context>): PrismaSourceAdapter<Context> {
  const viewConfigs = createPrismaViewConfigs({ prisma, views });
  const sourceDefinitions = createSourceDefinitions(viewConfigs, {
    resolveRelation: inferPrismaRelation,
  });
  const sourcesByView = new Map<DataView<AnyRecord>, Source>(
    sourceDefinitions.map((source) => [source.view, source]),
  );
  const sourcesByFields = new Map<DataView<AnyRecord>['fields'], Source>(
    sourceDefinitions.map((source) => [source.view.fields, source]),
  );
  const delegates = new Map<Source, (ctx: Context) => PrismaDelegate>(
    viewConfigs.map((config, index) => [
      sourceDefinitions[index] as Source,
      (ctx: Context) => config.delegate(ctx) as PrismaDelegate,
    ]),
  );

  const getSource = <Item extends AnyRecord = AnyRecord>(
    target: SourceTarget<Item>,
  ): SourceDefinition<Item, unknown> => {
    if (isSourceDefinition(target)) {
      return target;
    }

    const source = sourcesByView.get(target) ?? sourcesByFields.get(target.fields);
    if (!source) {
      throw new Error(`No source registered for view ${target.typeName}.`);
    }
    return source as SourceDefinition<Item, unknown>;
  };

  const getDelegate = (ctx: Context, source: Source): PrismaDelegate => {
    const getSourceDelegate = delegates.get(source);
    if (!getSourceDelegate) {
      throw new Error(`No Prisma delegate registered for source ${source.view.typeName}.`);
    }
    return getSourceDelegate(ctx);
  };

  const countChildrenByParentKey = async ({
    ctx,
    foreignKey,
    parentKeys,
    source,
    where,
  }: {
    ctx: Context;
    foreignKey: string;
    parentKeys: Array<unknown>;
    source: Source;
    where?: unknown;
  }) => {
    const delegate = getDelegate(ctx, source);

    if (!delegate.groupBy) {
      throw new Error(`Source ${source.view.typeName} does not support grouped count hydration.`);
    }

    const rows = await delegate.groupBy({
      _count: { _all: true },
      by: [foreignKey],
      where: {
        [foreignKey]: { in: parentKeys },
        ...((where as AnyRecord | undefined) ?? {}),
      },
    });

    return new Map(
      rows.map((row) => [
        row[foreignKey],
        (((row._count as AnyRecord | undefined)?._all as number | undefined) ?? 0) as number,
      ]),
    );
  };

  const attachConflictingComputedCounts = async ({
    ctx,
    items,
    node,
    source,
  }: {
    ctx: Context;
    items: Array<AnyRecord>;
    node: SourcePlanNode<Context>;
    source: Source;
  }): Promise<Array<AnyRecord>> => {
    if (items.length === 0) {
      return items;
    }

    const conflictingRequests = getConflictingCountRequests(node);

    for (const [relationName, requests] of conflictingRequests) {
      const relation = source.relations?.[relationName];

      if (!relation || relation.kind !== 'many') {
        throw new Error(
          `Conflicting computed counts on ${source.view.typeName}.${relationName} require a 'many' relation in the Prisma executor.`,
        );
      }

      const childSource = resolveSourceReference(relation.source);
      const parentKeys = [
        ...new Set(
          items
            .map((item) => item[relation.localKey])
            .filter((value) => value !== null && value !== undefined),
        ),
      ];
      const assignmentsBySignature = new Map<
        string,
        { requests: Array<CountRequest>; where?: unknown }
      >();

      for (const request of requests) {
        const signature = stableStringify(request.where ?? null);
        const assignment = assignmentsBySignature.get(signature) ?? {
          requests: [],
          where: request.where,
        };
        assignment.requests.push(request);
        assignmentsBySignature.set(signature, assignment);
      }

      for (const { requests: signatureRequests, where } of assignmentsBySignature.values()) {
        const counts = await countChildrenByParentKey({
          ctx,
          foreignKey: relation.foreignKey,
          parentKeys,
          source: childSource,
          where,
        });

        for (const item of items) {
          const parentKey = item[relation.localKey];
          const count = counts.get(parentKey) ?? 0;

          for (const request of signatureRequests) {
            attachComputedState(item, request.field, {
              [request.needName]: count,
            });
          }
        }
      }
    }

    for (const [relationName, relationNode] of node.relations) {
      const relation = source.relations?.[relationName];
      if (!relation) {
        continue;
      }

      const childSource = resolveSourceReference(relation.source);
      const childItems = items.flatMap((item) => {
        const value = item[relationName];
        if (Array.isArray(value)) {
          return value.filter(isRecord);
        }
        return isRecord(value) ? [value] : [];
      });

      await attachConflictingComputedCounts({
        ctx,
        items: childItems,
        node: relationNode,
        source: childSource,
      });
    }

    return items;
  };

  const hydrateComputedCounts = async <Item extends AnyRecord>({
    ctx,
    items,
    plan,
  }: {
    ctx: Context;
    items: Array<AnyRecord>;
    plan: SourcePlan<Item, Context>;
  }) =>
    attachConflictingComputedCounts({
      ctx,
      items,
      node: plan.root,
      source: plan.source as Source,
    });

  const fetchByIds = async <Item extends AnyRecord>({
    ctx,
    extra,
    ids,
    plan,
  }: {
    ctx: Context;
    extra?: PrismaQueryExtra;
    ids: Array<string>;
    plan: SourcePlan<Item, Context>;
  }) => {
    const delegate = getDelegate(ctx, plan.source as Source);

    if (!delegate.findMany) {
      throw new Error(`Source ${plan.source.view.typeName} does not support byIds execution.`);
    }

    return hydrateComputedCounts({
      ctx,
      items: await delegate.findMany({
        ...extra,
        select: toPrismaSelect(plan),
        where: { id: { in: ids } },
      }),
      plan,
    }) as Promise<Array<Item>>;
  };

  const fetchById = async <Item extends AnyRecord>({
    ctx,
    extra,
    id,
    plan,
  }: {
    ctx: Context;
    extra?: PrismaQueryExtra;
    id: string;
    plan: SourcePlan<Item, Context>;
  }) => {
    const delegate = getDelegate(ctx, plan.source as Source);

    if (delegate.findUnique) {
      return (
        (
          (await hydrateComputedCounts({
            ctx,
            items: (
              await Promise.all([
                delegate.findUnique({
                  ...extra,
                  select: toPrismaSelect(plan),
                  where: { id },
                }),
              ])
            ).flatMap((item) => (item ? [item] : [])),
            plan,
          })) as Array<Item>
        )[0] ?? null
      );
    }

    return (await fetchByIds({ ctx, extra, ids: [id], plan }))[0] ?? null;
  };

  const fetchConnection = async <Item extends AnyRecord>({
    ctx,
    cursor,
    direction,
    extra,
    plan,
    skip,
    take,
  }: {
    ctx: Context;
    cursor?: string;
    direction: 'backward' | 'forward';
    extra?: PrismaQueryExtra;
    plan: SourcePlan<Item, Context>;
    skip?: number;
    take: number;
  }) => {
    const delegate = getDelegate(ctx, plan.source as Source);

    if (!delegate.findMany) {
      throw new Error(`Source ${plan.source.view.typeName} does not support connection execution.`);
    }

    const hydrated = await hydrateComputedCounts({
      ctx,
      items: await delegate.findMany({
        ...extra,
        ...prismaConnectionArgs({ cursor, direction, node: plan.root, skip, take }),
        select: toPrismaSelect(plan),
      }),
      plan,
    });

    return (direction === 'backward' ? [...hydrated].reverse() : hydrated) as Array<Item>;
  };

  const registry = createSourceRegistry<Context>(
    sourceDefinitions.map((source) => [
      source as Source,
      {
        byId: ({ ctx, extra, id, plan }) =>
          fetchById({ ctx, extra: extra as PrismaQueryExtra | undefined, id, plan }),
        byIds: ({ ctx, extra, ids, plan }) =>
          fetchByIds({ ctx, extra: extra as PrismaQueryExtra | undefined, ids, plan }),
        connection: ({ ctx, cursor, direction, extra, plan, skip, take }) =>
          fetchConnection({
            ctx,
            cursor,
            direction,
            extra: extra as PrismaQueryExtra | undefined,
            plan,
            skip,
            take,
          }),
      },
    ]),
  );

  return {
    fetchById,
    fetchByIds,
    fetchConnection,
    getSource,
    registry,
    resolveById: <Item extends AnyRecord = AnyRecord>({
      ctx,
      extra,
      id,
      input,
      view,
    }: {
      ctx: Context;
      extra?: PrismaQueryExtra;
      id: string;
      input: SourceInput;
      view: ViewTarget<Item>;
    }) =>
      resolveSourceById({
        ctx,
        extra,
        id,
        input,
        registry,
        source: getSource(view),
      }),
    resolveByIds: <Item extends AnyRecord = AnyRecord>({
      ctx,
      extra,
      ids,
      input,
      view,
    }: {
      ctx: Context;
      extra?: PrismaQueryExtra;
      ids: Array<string>;
      input: SourceInput;
      view: ViewTarget<Item>;
    }) =>
      resolveSourceByIds({
        ctx,
        extra,
        ids,
        input,
        registry,
        source: getSource(view),
      }),
    resolveConnection: <Item extends AnyRecord = AnyRecord>({
      ctx,
      cursor,
      direction,
      extra,
      input,
      skip,
      take,
      view,
    }: {
      ctx: Context;
      cursor?: string;
      direction: 'backward' | 'forward';
      extra?: PrismaQueryExtra;
      input: SourceInput;
      skip?: number;
      take: number;
      view: ViewTarget<Item>;
    }) =>
      resolveSourceConnection({
        ctx,
        cursor,
        direction,
        extra,
        input,
        registry,
        skip,
        source: getSource(view),
        take,
      }),
  };
}

export const createPrismaSourceRegistry = <Context>(
  options: Parameters<typeof createPrismaSourceAdapter<Context>>[0],
) => createPrismaSourceAdapter<Context>(options).registry;

export function createPrismaFate<Context, Procedure extends ProcedureLike>({
  procedure,
  ...options
}: Parameters<typeof createPrismaSourceAdapter<Context>>[0] & {
  procedure: Procedure;
}) {
  const adapter = createPrismaSourceAdapter<Context>(options);
  const connection = withConnection(procedure);
  const procedures = bindSourceProcedures<Context, Procedure, typeof connection>({
    createConnectionProcedure: connection,
    procedure,
    registry: adapter.registry,
  });

  return {
    ...adapter,
    connection,
    createPlan: <Item extends AnyRecord = AnyRecord>({
      args,
      ctx,
      select,
      view,
    }: SourceInput & {
      ctx?: Context;
      view: ViewTarget<Item>;
    }) =>
      createSourcePlan({
        args,
        ctx,
        select,
        source: adapter.getSource(view),
      }),
    procedures: <
      Item extends AnyRecord,
      ById extends boolean | undefined = undefined,
      List extends boolean | ListConfig | undefined = undefined,
    >(
      input: ViewProcedureInput<Item, ById, List>,
    ) => {
      const procedureInput = input as any;
      const options =
        procedureInput && typeof procedureInput === 'object' && 'view' in procedureInput
          ? { ...procedureInput, source: adapter.getSource(procedureInput.view) }
          : adapter.getSource(input as ViewTarget<Item>);
      return procedures<Item, ById, List>(options);
    },
    resolveById: <Item extends AnyRecord = AnyRecord>({
      ctx,
      extra,
      id,
      input,
      view,
    }: {
      ctx: Context;
      extra?: PrismaQueryExtra;
      id: string;
      input: SourceInput;
      view: ViewTarget<Item>;
    }) =>
      resolveSourceById({
        ctx,
        extra,
        id,
        input,
        registry: adapter.registry,
        source: adapter.getSource(view),
      }),
    resolveByIds: <Item extends AnyRecord = AnyRecord>({
      ctx,
      extra,
      ids,
      input,
      view,
    }: {
      ctx: Context;
      extra?: PrismaQueryExtra;
      ids: Array<string>;
      input: SourceInput;
      view: ViewTarget<Item>;
    }) =>
      resolveSourceByIds({
        ctx,
        extra,
        ids,
        input,
        registry: adapter.registry,
        source: adapter.getSource(view),
      }),
    resolveConnection: <Item extends AnyRecord = AnyRecord>({
      ctx,
      cursor,
      direction,
      extra,
      input,
      skip,
      take,
      view,
    }: {
      ctx: Context;
      cursor?: string;
      direction: 'backward' | 'forward';
      extra?: PrismaQueryExtra;
      input: SourceInput;
      skip?: number;
      take: number;
      view: ViewTarget<Item>;
    }) =>
      resolveSourceConnection({
        ctx,
        cursor,
        direction,
        extra,
        input,
        registry: adapter.registry,
        skip,
        source: adapter.getSource(view),
        take,
      }),
  };
}
