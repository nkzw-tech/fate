import type { GraphQLSchema } from 'graphql';
import {
  graphQLOutputRelations,
  validateGraphQLRefetchMappings,
  type GraphQLByIdConfig,
} from '../graphqlSchema.ts';
import { sortObjectKeys } from '../sortObjectKeys.ts';
import type { FateViteTransport } from '../viteTypes.ts';
import {
  createGraphQLArgumentSchema,
  graphQLArgumentContracts,
  graphQLTypeScriptType,
} from './graphql.ts';
import { createSchema, isDataView } from './schema.ts';

type ModuleExports = Record<string, any>;
type ClientModule = '@nkzw/fate' | 'preact-fate' | 'react-fate' | 'vue-fate';

const formatRelation = (value: {
  array?: boolean;
  embedded?: string;
  listOf?: string;
  possibleTypes?: ReadonlyArray<string>;
  type?: string;
}) =>
  'listOf' in value
    ? `{ listOf: '${value.listOf}'${value.array ? ', array: true' : ''}${value.possibleTypes ? `, possibleTypes: ${JSON.stringify(value.possibleTypes)}` : ''} }`
    : 'embedded' in value
      ? `{ embedded: '${value.embedded}' }`
      : `{ type: '${value.type}'${value.possibleTypes ? `, possibleTypes: ${JSON.stringify(value.possibleTypes)}` : ''} }`;

const formatTypes = (
  types: ReadonlyArray<{
    fields?: Record<string, any>;
    possibleTypes?: ReadonlyArray<string>;
    type: string;
  }>,
) => {
  if (!types.length) {
    return '[]';
  }

  const lines = ['['];
  for (const typeConfig of types) {
    lines.push('  {');
    if (typeConfig.fields) {
      lines.push('    fields: {');
      for (const [field, relation] of Object.entries(typeConfig.fields)) {
        lines.push(`      ${field}: ${formatRelation(relation)},`);
      }
      lines.push('    },');
    }
    if (typeConfig.possibleTypes) {
      lines.push(`    possibleTypes: ${JSON.stringify(typeConfig.possibleTypes)},`);
    }
    lines.push(`    type: '${typeConfig.type}',`, '  },');
  }
  lines.push(']');
  return lines.join('\n');
};

const indentBlock = (value: string, spaces: number) =>
  value
    .split('\n')
    .map((line) => (line.length ? `${' '.repeat(spaces)}${line}` : line))
    .join('\n');

const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const getHydrationScope = (
  moduleName: string,
  roots: Record<string, unknown>,
  types: ReadonlyArray<{ type: string }>,
) =>
  JSON.stringify(
    sortObjectKeys({
      moduleName,
      roots,
      types: [...types].sort((left, right) => compareStrings(left.type, right.type)),
    }),
  );

export const createClientSource = ({
  clientModule = 'react-fate',
  moduleExports,
  moduleName,
  runtimeModuleName = moduleName,
  transport = 'trpc',
}: {
  clientModule?: ClientModule;
  moduleExports: ModuleExports;
  moduleName: string;
  runtimeModuleName?: string;
  transport?: FateViteTransport;
}) => {
  if (transport === 'graphql') {
    return createGraphQLClientSource({
      clientModule,
      moduleExports,
      moduleName,
    });
  }

  if (transport === 'native' || transport === 'void') {
    return createNativeClientSource({
      clientModule,
      moduleExports,
      moduleName,
      runtimeModuleName,
      voidTransport: transport === 'void',
    });
  }

  const { appRouter, Root } = moduleExports;
  const { roots, types } = createSchema(
    Object.values(moduleExports).filter(isDataView),
    Root ?? {},
  );
  const routerRecord = appRouter._def?.record ?? {};

  const mutationEntries: Array<{
    entityType: string;
    name: string;
    procedure: string;
    router: string;
  }> = [];
  const byIdEntries: Array<{ entityType: string; router: string }> = [];
  const listEntries: Array<{
    list: string;
    procedure: string;
    router: string;
    type: string;
  }> = [];
  const queryEntries: Array<{ name: string; procedure: string; router: string; type: string }> = [];

  const rootsByRouter = new Map<string, Array<[string, (typeof roots)[string]]>>();
  for (const entry of Object.entries(roots)) {
    const list = rootsByRouter.get(entry[1].router) ?? [];
    list.push(entry as [string, (typeof roots)[string]]);
    rootsByRouter.set(entry[1].router, list);
  }

  for (const [router, procedures] of Object.entries(routerRecord)) {
    const routerRoots = rootsByRouter.get(router);
    if (!routerRoots?.length) {
      continue;
    }

    const entityType = routerRoots[0][1].type;

    for (const [procedureName, procedure] of Object.entries(procedures as Record<string, any>)) {
      const type = procedure?._def?.type;
      if (!type) {
        continue;
      }

      if (type === 'mutation') {
        mutationEntries.push({
          entityType,
          name: `${router}.${procedureName}`,
          procedure: procedureName,
          router,
        });
        continue;
      }

      if (procedureName === 'byId' && type === 'query') {
        byIdEntries.push({ entityType, router });
        continue;
      }

      for (const [queryName, root] of routerRoots) {
        if (root.kind !== 'query') {
          continue;
        }

        if (procedureName === root.procedure && type === 'query') {
          queryEntries.push({
            name: queryName,
            procedure: root.procedure,
            router,
            type: root.type,
          });
        }
      }

      for (const [listName, root] of routerRoots) {
        if (root.kind !== 'list') {
          continue;
        }

        if (procedureName === root.procedure && type === 'query') {
          listEntries.push({
            list: listName,
            procedure: root.procedure,
            router,
            type: root.type,
          });
        }
      }
    }
  }

  mutationEntries.sort((a, b) => a.name.localeCompare(b.name));
  byIdEntries.sort((a, b) => a.entityType.localeCompare(b.entityType));
  queryEntries.sort((a, b) => a.name.localeCompare(b.name));
  listEntries.sort((a, b) => a.list.localeCompare(b.list));

  const rootEntries = [
    ...byIdEntries.map(({ entityType, router }) => ({
      name: router,
      type: entityType,
      value: `'${router}': clientRoot<RouterOutputs['${router}']['byId'], '${entityType}'>('${entityType}'),`,
    })),
    ...queryEntries.map(({ name, procedure, router, type }) => ({
      name,
      type,
      value: `'${name}': clientRoot<RouterOutputs['${router}']['${procedure}'], '${type}'>('${type}'),`,
    })),
    ...listEntries.map(({ list, procedure, router, type }) => ({
      name: list,
      type,
      value: `'${list}': clientRoot<RouterOutputs['${router}']['${procedure}'], '${type}'>('${type}'),`,
    })),
  ];

  rootEntries.sort((a, b) => a.name.localeCompare(b.name));

  const viewTypes = Array.from([
    'AppRouter',
    ...new Set(mutationEntries.map((entry) => entry.entityType)),
  ]).sort();

  const mutationResolverLines = mutationEntries.map(
    ({ name, procedure, router }) =>
      `'${name}': (client: TRPCClientType) => client.${router}.${procedure}.mutate,`,
  );

  const mutationConfigLines = mutationEntries.map(
    ({ entityType, name, procedure, router }) =>
      `'${name}': mutation<
  ${entityType},
  RouterInputs['${router}']['${procedure}'],
  RouterOutputs['${router}']['${procedure}']
>('${entityType}'),`,
  );

  const byIdLines = byIdEntries.map(
    ({ entityType, router }) =>
      `${entityType}: (client: TRPCClientType) => ({
  args,
  ids,
  select,
}: { args?: Record<string, unknown>; ids: Array<string | number>; select: Array<string> }) =>
  client.${router}.byId.query({
    args,
    ids: ids.map(String),
    select,
  }),`,
  );
  const listLines = listEntries.map(
    ({ list, procedure, router }) =>
      `${list}: (client: TRPCClientType) => client.${router}.${procedure}.query,`,
  );
  const queryLines = queryEntries.map(
    ({ name, procedure, router }) =>
      `${name}: (client: TRPCClientType) => client.${router}.${procedure}.query,`,
  );

  const typeImports = `import type { ${viewTypes.join(', ')} } from '${moduleName}';`;

  const typesBlock = indentBlock(
    formatTypes(
      types as ReadonlyArray<{
        fields?: Record<string, any>;
        type: string;
      }>,
    ),
    6,
  );

  const mutationResolverBlock = indentBlock(mutationResolverLines.join('\n'), 4);
  const mutationConfigBlock = indentBlock(mutationConfigLines.join('\n'), 2);
  const byIdBlock = indentBlock(byIdLines.join('\n'), 8);
  const rootBlockContent = rootEntries.map((entry) => entry.value).join('\n');
  const rootsBlock = indentBlock(rootBlockContent, 2);
  const listsBlockContent = listLines.join('\n');
  const listsBlock = listLines.length
    ? `      lists: {\n${indentBlock(listsBlockContent, 8)}\n      },\n`
    : '';
  const queriesBlockContent = queryLines.join('\n');
  const queriesBlock = queryLines.length
    ? `      queries: {\n${indentBlock(queriesBlockContent, 8)}\n      },\n`
    : '';
  const trpcFateServer = moduleExports.fateServer?.manifest ? moduleExports.fateServer : null;
  const hasLive = Object.keys(trpcFateServer?.manifest.live ?? {}).length > 0;
  const liveOptions = hasLive
    ? `fetch?: typeof fetch;
headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
liveRetryMs?: number;
liveUrl: string | URL;`
    : '';
  const liveImport = hasLive ? ', createHTTPTransport' : '';
  const liveTransportSetup = hasLive
    ? `
  const liveTransport = createHTTPTransport({
    fetch: options.fetch,
    headers: options.headers,
    liveRetryMs: options.liveRetryMs,
    url: options.liveUrl,
  });
`
    : '';
  const liveTransportAssignment = hasLive
    ? `
  transport.subscribeById = liveTransport.subscribeById;
  transport.subscribeConnection = liveTransport.subscribeConnection;
`
    : '';
  const clientDeclarationModule = `${clientModule}/client`;

  const generatedClientTypes = `
declare module '${clientDeclarationModule}' {
  interface ClientMutations extends GeneratedClientMutations {}
  interface ClientRoots extends GeneratedClientRoots {}

  export function createFateClient(
    ...args: Parameters<GeneratedCreateFateClient>
  ): ReturnType<GeneratedCreateFateClient>;
}
`;

  return `// @generated by @nkzw/fate/vite
${typeImports}
import { createTRPCProxyClient } from '@trpc/client';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { clientRoot, createClient${liveImport}, createTRPCTransport, mutation } from '${clientModule}';

type TRPCClientType = ReturnType<typeof createTRPCProxyClient<AppRouter>>;
type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;

const mutations = {
${mutationConfigBlock}
} as const;

const roots = {
${rootsBlock}
} as const;

export type GeneratedClientMutations = typeof mutations;
export type GeneratedClientRoots = typeof roots;
const hydrationScope = ${JSON.stringify(getHydrationScope(moduleName, roots, types))} as const;

const trpcMutations = {
${mutationResolverBlock}
} as const;

export const createFateClient = (options: {
  links: Parameters<typeof createTRPCProxyClient>[0]['links'];
${indentBlock(liveOptions.trim(), 2)}
  mutateDurably?: Parameters<typeof createTRPCTransport<AppRouter, typeof trpcMutations>>[0]['mutateDurably'];
  onLiveError?: (error: unknown) => void;
  persistence?: import("@nkzw/fate").Persistence;
}) => {
  const trpcClient = createTRPCProxyClient<AppRouter>(options);
${liveTransportSetup}

  const transport = createTRPCTransport<AppRouter, typeof trpcMutations>({
    byId: {
${byIdBlock}
    },
    client: trpcClient,
${queriesBlock}${listsBlock}    mutations: trpcMutations,
    mutateDurably: options.mutateDurably,
  });
${liveTransportAssignment}

  return createClient<[GeneratedClientRoots, GeneratedClientMutations], typeof hydrationScope>({
    hydrationScope,
    mutations,
    onLiveError: options.onLiveError,
    persistence: options.persistence,
    roots,
    transport,
    types: ${typesBlock.trimStart()},
  });
};

type GeneratedCreateFateClient = typeof createFateClient;
${generatedClientTypes}
`;
};

const lowerTypeName = (type: string) => type[0]?.toLowerCase() + type.slice(1);

const graphQLConfigExportName = 'fateGraphQL';

const formatGraphQLObject = (value: unknown, depth = 0): string => {
  const indent = '  '.repeat(depth);
  const nextIndent = '  '.repeat(depth + 1);

  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => formatGraphQLObject(entry, depth)).join(', ')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, entry]) => entry !== undefined,
  );
  if (entries.length === 0) {
    return '{}';
  }

  return `{\n${entries
    .map(
      ([key, entry]) =>
        `${nextIndent}${JSON.stringify(key)}: ${formatGraphQLObject(entry, depth + 1)},`,
    )
    .join('\n')}\n${indent}}`;
};

const createGraphQLClientSource = ({
  clientModule,
  moduleExports,
  moduleName,
}: {
  clientModule: ClientModule;
  moduleExports: ModuleExports;
  moduleName: string;
}) => {
  const { Root } = moduleExports;
  const { roots, types } = createSchema(
    Object.values(moduleExports).filter(isDataView),
    Root ?? {},
  );
  const graphQLConfig = (moduleExports[graphQLConfigExportName] ?? {}) as {
    byId?: Readonly<Record<string, GraphQLByIdConfig>>;
    mutations?: Record<
      string,
      { entity: string; field: string; inputArg?: false | string; type?: string }
    >;
    nodes?: boolean;
    roots?: Record<string, { embedded?: boolean; field?: string; type?: string }>;
    schema?: string | GraphQLSchema;
    types?: ReadonlyArray<{ fields?: Record<string, any>; type: string }>;
  };
  const argumentSchema = graphQLConfig.schema
    ? createGraphQLArgumentSchema(graphQLConfig.schema)
    : undefined;
  validateGraphQLRefetchMappings(graphQLConfig.byId, argumentSchema);
  const inferredTypes = graphQLOutputRelations(argumentSchema);
  const inferredByType = new Map(inferredTypes.map((entry) => [entry.type, entry]));
  const explicitByType = new Map((graphQLConfig.types ?? []).map((entry) => [entry.type, entry]));
  const transportTypes = [
    ...types.map((entry) => ({
      ...entry,
      fields: {
        ...entry.fields,
        ...inferredByType.get(entry.type)?.fields,
        ...explicitByType.get(entry.type)?.fields,
      },
      possibleTypes: inferredByType.get(entry.type)?.possibleTypes,
    })),
    ...(graphQLConfig.types ?? [])
      .filter((entry) => !types.some((type) => type.type === entry.type))
      .map((entry) => ({
        ...entry,
        fields: { ...inferredByType.get(entry.type)?.fields, ...entry.fields },
        possibleTypes: inferredByType.get(entry.type)?.possibleTypes,
      })),
    ...inferredTypes.filter(
      (entry) =>
        argumentSchema?.outputs?.[entry.type]?.id &&
        !types.some((type) => type.type === entry.type) &&
        !(graphQLConfig.types ?? []).some((type) => type.type === entry.type),
    ),
  ];
  const selectionTypes = [
    ...transportTypes,
    ...inferredTypes.filter((entry) => !transportTypes.some((type) => type.type === entry.type)),
  ];
  const mutationInputType = (name: string, field: string, inputArg?: false | string) => {
    if (!argumentSchema) {
      return `GraphQLMutationInput<typeof ${graphQLConfigExportName}.mutations['${name}']>`;
    }
    const args = argumentSchema.fields[argumentSchema.mutationType ?? 'Mutation']?.[field];
    if (!args) {
      throw new Error(`fate(graphql): Unknown mutation field '${field}'.`);
    }
    if (inputArg === false) {
      return `GraphQLFieldArguments[${JSON.stringify(argumentSchema.mutationType)}][${JSON.stringify(field)}]`;
    }
    const input = args[inputArg ?? 'input'];
    if (!input) {
      throw new Error(`fate(graphql): Unknown input argument '${field}.${inputArg ?? 'input'}'.`);
    }
    if (
      Object.entries(args).some(
        ([key, value]) =>
          key !== (inputArg ?? 'input') && value.type.endsWith('!') && !value.hasDefault,
      )
    ) {
      throw new Error(
        `fate(graphql): Mutation '${field}' has additional required arguments; use inputArg: false.`,
      );
    }
    return graphQLTypeScriptType(input.type, argumentSchema);
  };
  if (argumentSchema) {
    for (const [name] of Object.entries({ ...roots, ...graphQLConfig.roots })) {
      const field = graphQLConfig.roots?.[name]?.field ?? name;
      if (!argumentSchema.fields[argumentSchema.queryType]?.[field]) {
        throw new Error(`fate(graphql): Unknown query field '${field}'.`);
      }
    }
    for (const dataView of Object.values(moduleExports).filter(isDataView)) {
      for (const field of Object.keys(dataView.fields)) {
        if (!argumentSchema.fields[dataView.typeName]?.[field]) {
          throw new Error(`fate(graphql): Unknown field '${dataView.typeName}.${field}'.`);
        }
      }
    }
  }
  const selectionArguments = argumentSchema
    ? `
export type GraphQLSelectionArguments = {
${selectionTypes
  .map(
    ({ fields, type }) => `  ${JSON.stringify(type)}: {
${Object.entries(argumentSchema.fields[type] ?? {})
  .flatMap(([field, args]) => {
    const relation = fields?.[field];
    const child =
      relation &&
      ('type' in relation
        ? relation.type
        : 'embedded' in relation
          ? relation.embedded
          : relation.listOf);
    if (!child && !Object.keys(args).length) {
      return [];
    }
    const contract = Object.keys(args).length
      ? `GraphQLFieldArguments[${JSON.stringify(type)}][${JSON.stringify(field)}]`
      : '';
    return [
      `    ${JSON.stringify(field)}?: ${[contract, child ? `GraphQLSelectionArguments[${JSON.stringify(child)}]` : ''].filter(Boolean).join(' & ')};`,
    ];
  })
  .join('\n')}
  };`,
  )
  .join('\n')}
};`
    : '';
  const rootArgumentsType = (name: string, type: string) => {
    if (!argumentSchema) {
      return '';
    }
    const field = graphQLConfig.roots?.[name]?.field ?? name;
    const args = argumentSchema.fields[argumentSchema.queryType][field];
    return `, ${Object.keys(args).length ? `GraphQLFieldArguments[${JSON.stringify(argumentSchema.queryType)}][${JSON.stringify(field)}] & ` : ''}GraphQLSelectionArguments[${JSON.stringify(type)}]`;
  };
  const byIdEntries = types.map((entry) => ({
    name: lowerTypeName(entry.type),
    type: entry.type,
  }));
  const nullableRoot = (name: string) => {
    if (!argumentSchema) {
      return false;
    }
    const field = graphQLConfig.roots?.[name]?.field ?? name;
    return !argumentSchema.outputs?.[argumentSchema.queryType]?.[field]?.endsWith('!');
  };
  const mutationEntries = Object.entries(graphQLConfig.mutations ?? {}).map(([name, config]) => ({
    entity: config.entity,
    field: config.field,
    inputArg: config.inputArg,
    name,
    type: config.type,
  }));
  const rootEntries = [
    ...byIdEntries.map(({ name, type }) => ({
      name,
      type,
      value: `'${name}': clientRoot<Array<${type}>, '${type}'>('${type}'),`,
    })),
    ...Object.entries(roots)
      .filter(([name]) => !graphQLConfig.roots?.[name]?.embedded)
      .map(([name, root]) => ({
        name,
        type: root.type,
        value: `'${name}': clientRoot<${
          root.kind === 'list'
            ? `{
  items: Array<{ cursor?: string; node: ${root.type} }>;
  pagination: import('${clientModule}').Pagination;
}${nullableRoot(name) ? ' | null' : ''}`
            : `${root.type} | null`
        }, '${root.type}'${rootArgumentsType(name, root.type)}>('${root.type}'),`,
      })),
    ...Object.entries(graphQLConfig.roots ?? {})
      .filter(([, root]) => root.embedded)
      .map(([name]) => ({
        name,
        type: '__value__',
        value: `'${name}': clientValueRoot<GraphQLRootOutput<typeof ${graphQLConfigExportName}.roots['${name}']>, GraphQLRootInput<typeof ${graphQLConfigExportName}.roots['${name}']>>(),`,
      })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const importedTypes = Array.from(
    new Set([
      ...types.map((type) => type.type),
      ...mutationEntries
        .filter((entry) => entry.entity !== '__value__')
        .map((entry) => entry.entity),
      ...(mutationEntries.length ||
      Object.values(graphQLConfig.roots ?? {}).some((root) => root.embedded) ||
      (!argumentSchema && graphQLConfig.mutations)
        ? [graphQLConfigExportName]
        : []),
    ]),
  ).sort((a, b) => a.localeCompare(b));

  const mutationConfigLines = mutationEntries.map(({ entity, field, inputArg, name }) =>
    entity === '__value__'
      ? `'${name}': valueMutation<
  ${mutationInputType(name, field, inputArg)},
  GraphQLMutationOutput<typeof ${graphQLConfigExportName}.mutations['${name}']>
>(),`
      : `'${name}': mutation<
  ${entity},
  ${mutationInputType(name, field, inputArg)},
  GraphQLMutationOutput<typeof ${graphQLConfigExportName}.mutations['${name}']>
>('${entity}'),`,
  );

  const graphQLRoots = Object.fromEntries(
    Object.entries({
      ...roots,
      ...Object.fromEntries(
        Object.entries(graphQLConfig.roots ?? {}).filter(([, root]) => root.embedded),
      ),
    }).map(([name, root]) => [
      name,
      {
        connection: 'kind' in root && root.kind === 'list' ? 'relay' : undefined,
        embedded: graphQLConfig.roots?.[name]?.embedded,
        field: graphQLConfig.roots?.[name]?.field,
        type: graphQLConfig.roots?.[name]?.type ?? root.type,
      },
    ]),
  );
  const graphQLMutations = Object.fromEntries(
    mutationEntries.map(({ entity, field, inputArg, name, type }) => [
      name,
      {
        entity,
        field,
        ...(inputArg !== undefined ? { inputArg } : null),
        ...(type !== undefined ? { type } : null),
      },
    ]),
  );
  const graphQLRuntimeConfig = {
    ...(graphQLConfig.byId ? { byId: graphQLConfig.byId } : null),
    mutations: graphQLMutations,
    ...(graphQLConfig.nodes !== undefined ? { nodes: graphQLConfig.nodes } : null),
    roots: graphQLRoots,
    ...(argumentSchema ? { schema: argumentSchema } : null),
  };

  const typesBlock = indentBlock(
    formatTypes(
      transportTypes as ReadonlyArray<{
        fields?: Record<string, any>;
        type: string;
      }>,
    ),
    6,
  );
  const rootBlock = indentBlock(rootEntries.map((entry) => entry.value).join('\n'), 2);
  const mutationConfigBlock = indentBlock(mutationConfigLines.join('\n'), 2);
  const clientDeclarationModule = `${clientModule}/client`;
  const generatedClientTypes = `
declare module '${clientDeclarationModule}' {
  interface ClientMutations extends GeneratedClientMutations {}
  interface ClientRoots extends GeneratedClientRoots {}

  export function createFateClient(
    ...args: Parameters<GeneratedCreateFateClient>
  ): ReturnType<GeneratedCreateFateClient>;
}
`;
  const mutationMapType = argumentSchema
    ? `{ ${mutationEntries.map(({ field, inputArg, name }) => `${JSON.stringify(name)}: { input: ${mutationInputType(name, field, inputArg)}; output: GraphQLMutationOutput<typeof ${graphQLConfigExportName}.mutations[${JSON.stringify(name)}]> };`).join(' ')} }`
    : graphQLConfig.mutations
      ? `GraphQLMutationMap<typeof ${graphQLConfigExportName}.mutations>`
      : 'Record<never, never>';
  const typeImportLine = importedTypes.length
    ? `import type { ${importedTypes.join(', ')} } from '${moduleName}';\n`
    : '';

  return `// @generated by @nkzw/fate/vite
${typeImportLine}import { clientRoot, createClient, createGraphQLTransport${Object.values(graphQLConfig.roots ?? {}).some((root) => root.embedded) ? ', clientValueRoot, type GraphQLRootInput, type GraphQLRootOutput' : ''}${mutationEntries.some((entry) => entry.entity !== '__value__') ? ', mutation' : ''}${mutationEntries.some((entry) => entry.entity === '__value__') ? ', valueMutation' : ''}${mutationEntries.length ? ', type GraphQLMutationOutput' : ''}${!argumentSchema && graphQLConfig.mutations ? ', type GraphQLMutationMap' : ''}${!argumentSchema && mutationEntries.length ? ', type GraphQLMutationInput' : ''} } from '${clientModule}';

${argumentSchema ? graphQLArgumentContracts(argumentSchema) : ''}
${selectionArguments}
type GraphQLTransportMutations = ${mutationMapType};

const graphQL = ${formatGraphQLObject(graphQLRuntimeConfig)} as const;

const mutations = {
${mutationConfigBlock}
} as const;

const roots = {
${rootBlock}
} as const;

export type GeneratedClientMutations = typeof mutations;
export type GeneratedClientRoots = typeof roots;
const hydrationScope = ${JSON.stringify(getHydrationScope(moduleName, argumentSchema ? { argumentSchema, roots } : roots, types))} as const;

export const createFateClient = (options: {
  decodeNodeId?: (type: string, id: string | number) => string | number;
  encodeNodeId?: (type: string, id: string | number) => string | number;
  eventSource?: Parameters<typeof createGraphQLTransport>[0]['eventSource'];
  fetch?: typeof fetch;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  live?: Parameters<typeof createGraphQLTransport>[0]['live'];
  mutateDurably?: Parameters<typeof createGraphQLTransport<GraphQLTransportMutations>>[0]['mutateDurably'];
  onLiveError?: (error: unknown) => void;
  persistence?: import("@nkzw/fate").Persistence;
  url: string | URL;
}) =>
  createClient<[GeneratedClientRoots, GeneratedClientMutations], typeof hydrationScope>({
    hydrationScope,
    mutations,
    onLiveError: options.onLiveError,
    persistence: options.persistence,
    roots,
    transport: createGraphQLTransport<GraphQLTransportMutations>({
      ${graphQLConfig.byId ? 'byId: graphQL.byId,' : ''}
      decodeNodeId: options.decodeNodeId,
      encodeNodeId: options.encodeNodeId,
      eventSource: options.eventSource,
      fetch: options.fetch,
      headers: options.headers,
      live: options.live,
      mutations: graphQL.mutations,
      mutateDurably: options.mutateDurably,
      ${graphQLConfig.nodes !== undefined ? 'nodes: graphQL.nodes,' : ''}
      roots: graphQL.roots,
      ${argumentSchema ? 'schema: graphQL.schema,' : ''}
      types: ${typesBlock.trimStart()},
      url: options.url,
    }),
    types: ${typesBlock.trimStart()},
  });

type GeneratedCreateFateClient = typeof createFateClient;
${generatedClientTypes}
`;
};

const createNativeClientSource = ({
  clientModule,
  moduleExports,
  moduleName,
  runtimeModuleName,
  voidTransport,
}: {
  clientModule: ClientModule;
  moduleExports: ModuleExports;
  moduleName: string;
  runtimeModuleName: string;
  voidTransport: boolean;
}) => {
  const { Root } = moduleExports;
  const fateExportName = moduleExports.fate?.manifest
    ? 'fate'
    : moduleExports.fateServer?.manifest
      ? 'fateServer'
      : null;
  const fateServer = fateExportName ? moduleExports[fateExportName] : null;
  if (!fateServer?.manifest) {
    throw new Error(
      `Native fate client generation requires the server module to export a value named "fate" or "fateServer" created by createFateServer().`,
    );
  }

  const { roots, types } = createSchema(
    Object.values(moduleExports).filter(isDataView),
    Root ?? {},
  );
  const manifest = fateServer.manifest as {
    live?: Record<string, true>;
    mutations?: Record<string, { type: string }>;
    types?: Record<string, true>;
  };
  const hasLive = Object.keys(manifest.live ?? {}).length > 0;

  const byIdEntries = Object.keys(manifest.types ?? {}).map((type) => ({
    name: lowerTypeName(type),
    type,
  }));
  const mutationEntries = Object.entries(manifest.mutations ?? {}).map(([name, config]) => ({
    name,
    type: config.type,
  }));
  const rootEntries = [
    ...byIdEntries.map(({ name, type }) => ({
      name,
      value: `'${name}': clientRoot<Array<${type}>, '${type}'>('${type}'),`,
    })),
    ...Object.entries(roots).map(([name, root]) => {
      const apiKey = name;
      const section = root.kind === 'list' ? 'lists' : 'queries';
      return {
        name,
        value: `'${name}': clientRoot<FateAPI['${section}']['${apiKey}']['output'], '${root.type}'>('${root.type}'),`,
      };
    }),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const importedTypes = Array.from(
    new Set([
      fateExportName === 'fate' ? 'fate as fateServer' : 'fateServer',
      ...types.map((type) => type.type),
      ...mutationEntries.map((entry) => entry.type),
    ]),
  ).sort((a, b) => a.localeCompare(b));

  const mutationConfigLines = mutationEntries.map(
    ({ name, type }) =>
      `'${name}': mutation<
  ${type},
  FateAPI['mutations']['${name}']['input'],
  FateAPI['mutations']['${name}']['output']
>('${type}'),`,
  );

  const typesBlock = indentBlock(
    formatTypes(
      types as ReadonlyArray<{
        fields?: Record<string, any>;
        type: string;
      }>,
    ),
    6,
  );

  const rootBlock = indentBlock(rootEntries.map((entry) => entry.value).join('\n'), 2);
  const mutationConfigBlock = indentBlock(mutationConfigLines.join('\n'), 2);
  const clientDeclarationModule = `${clientModule}/client`;
  const voidServerFetch = voidTransport
    ? `
import type { FateServer } from '@nkzw/fate/server';

const defaultVoidFateRpcPath = '/fate';
const defaultVoidFateLivePath = '/fate-live';

let serverFateFetchPromise: Promise<(request: Request) => Promise<Response>> | null = null;

const isFateServer = (value: unknown): value is FateServer<unknown> =>
  Boolean(value && typeof value === 'object' && 'manifest' in value);

const getServerFateFetch = async () => {
  serverFateFetchPromise ??= Promise.all([
    import('@nkzw/fate/server'),
    import('${runtimeModuleName}'),
  ]).then(([{ createFateFetchHandler }, serverModule]) => {
    const moduleRecord = serverModule as Record<string, unknown>;
    const server = isFateServer(moduleRecord.fate)
      ? moduleRecord.fate
      : isFateServer(moduleRecord.fateServer)
        ? moduleRecord.fateServer
        : null;

    if (!server) {
      throw new Error('void-fate: Expected the server module to export a Fate server named "fate" or "fateServer".');
    }

    return createFateFetchHandler(server);
  });

  return serverFateFetchPromise;
};

const getDefaultOrigin = () =>
  typeof window === 'undefined' ? 'http://localhost' : window.location.origin;

const toEndpointUrl = (url: string | URL | undefined, path: string, origin: string | URL) =>
  url ?? new URL(path, origin);

const createVoidFetch = (options: {
  fetch?: typeof fetch;
  userId?: null | string;
}): typeof fetch => {
  if (options.fetch) {
    return options.fetch;
  }

  if (import.meta.env.SSR) {
    return async (input, init) => (await getServerFateFetch())(new Request(input, init));
  }

  return (input, init) =>
    fetch(input, {
      ...init,
      credentials: options.userId ? 'include' : init?.credentials,
    });
};
`
    : '';
  const createClientOptions = voidTransport
    ? `options: {
  fetch?: typeof fetch;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  livePath?: string;
  liveRetryMs?: number;
  liveUrl?: string | URL;
  onLiveError?: (error: unknown) => void;
  persistence?: import("@nkzw/fate").Persistence;
  origin?: string | URL;
  rpcPath?: string;
  url?: string | URL;
  userId?: null | string;
} = {}`
    : `options: {
  fetch?: typeof fetch;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  liveRetryMs?: number;
  liveUrl?: string | URL;
  onLiveError?: (error: unknown) => void;
  persistence?: import("@nkzw/fate").Persistence;
  url: string | URL;
}`;
  const clientSetup = voidTransport
    ? ` => {
  const origin = options.origin ?? getDefaultOrigin();

  return createClient<[GeneratedClientRoots, GeneratedClientMutations], typeof hydrationScope>({
    hydrationScope,
    mutations,
    onLiveError: options.onLiveError,
    persistence: options.persistence,
    roots,
    transport: createHTTPTransport<FateAPI>({
      fetch: createVoidFetch(options),
      headers: options.headers,
      live: ${hasLive ? 'connectLiveStream' : 'false'},
      liveRetryMs: options.liveRetryMs,
      liveUrl: toEndpointUrl(
        options.liveUrl,
        options.livePath ?? defaultVoidFateLivePath,
        origin,
      ),
      url: toEndpointUrl(options.url, options.rpcPath ?? defaultVoidFateRpcPath, origin),
    }),
    types: ${typesBlock.trimStart()},
  });
}`
    : ` =>
  createClient<[GeneratedClientRoots, GeneratedClientMutations], typeof hydrationScope>({
    hydrationScope,
    mutations,
    onLiveError: options.onLiveError,
    persistence: options.persistence,
    roots,
    transport: createHTTPTransport<FateAPI>({
      fetch: options.fetch,
      headers: options.headers,
      live: ${String(hasLive)},
      liveRetryMs: options.liveRetryMs,
      liveUrl: options.liveUrl,
      url: options.url,
    }),
    types: ${typesBlock.trimStart()},
  })`;

  const generatedClientTypes = `
declare module '${clientDeclarationModule}' {
  interface ClientMutations extends GeneratedClientMutations {}
  interface ClientRoots extends GeneratedClientRoots {}

  export function createFateClient(
    ...args: Parameters<GeneratedCreateFateClient>
  ): ReturnType<GeneratedCreateFateClient>;
}
`;

  return `// @generated by @nkzw/fate/vite
import type { ${importedTypes.join(', ')} } from '${moduleName}';
import { clientRoot, createClient, createHTTPTransport, mutation, type InferFateAPI } from '${clientModule}';
${voidTransport && hasLive ? "import { connectLiveStream } from 'void/live/client';\n" : ''}${voidServerFetch}

type FateAPI = InferFateAPI<typeof fateServer>;

const mutations = {
${mutationConfigBlock}
} as const;

const roots = {
${rootBlock}
} as const;

export type GeneratedClientMutations = typeof mutations;
export type GeneratedClientRoots = typeof roots;
const hydrationScope = ${JSON.stringify(getHydrationScope(moduleName, roots, types))} as const;

export const createFateClient = (${createClientOptions})${clientSetup};

type GeneratedCreateFateClient = typeof createFateClient;
${generatedClientTypes}
`;
};
