import { createSchema, isDataView } from './schema.ts';

type ModuleExports = Record<string, any>;

const formatRelation = (value: { listOf?: string; type?: string }) =>
  'listOf' in value ? `{ listOf: '${value.listOf}' }` : `{ type: '${value.type}' }`;

const formatTypes = (types: ReadonlyArray<{ fields?: Record<string, any>; type: string }>) => {
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

export const createClientSource = ({
  moduleExports,
  moduleName,
  transport = 'trpc',
}: {
  moduleExports: ModuleExports;
  moduleName: string;
  transport?: 'native' | 'trpc';
}) => {
  if (transport === 'native') {
    return createNativeClientSource({ moduleExports, moduleName });
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
  const liveEntries: Array<{ entityType: string; router: string }> = [];
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

      if (procedureName === 'live' && type === 'subscription') {
        liveEntries.push({ entityType, router });
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
  liveEntries.sort((a, b) => a.entityType.localeCompare(b.entityType));
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
  const liveLines = liveEntries.map(
    ({ entityType, router }) =>
      `${entityType}: (client: TRPCClientType) => client.${router}.live.subscribe,`,
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
  const liveBlockContent = liveLines.join('\n');
  const liveBlock = liveLines.length
    ? `      live: {\n        byId: {\n${indentBlock(liveBlockContent, 10)}\n        },\n      },\n`
    : '';

  return `// @generated by @nkzw/fate/vite
${typeImports}
import { createTRPCProxyClient } from '@trpc/client';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { clientRoot, createClient, createTRPCTransport, mutation } from 'react-fate';

type TRPCClientType = ReturnType<typeof createTRPCProxyClient<AppRouter>>;
type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;

const mutations = {
${mutationConfigBlock}
} as const;

const roots = {
${rootsBlock}
} as const;

type GeneratedClientMutations = typeof mutations;
type GeneratedClientRoots = typeof roots;

declare module 'react-fate' {
  interface ClientMutations extends GeneratedClientMutations {}
  interface ClientRoots extends GeneratedClientRoots {}
}

export const createFateClient = (options: {
  links: Parameters<typeof createTRPCProxyClient>[0]['links'];
  onLiveError?: (error: unknown) => void;
}) => {
  const trpcClient = createTRPCProxyClient<AppRouter>(options);

  const trpcMutations = {
${mutationResolverBlock}
  } as const;

  return createClient<[GeneratedClientRoots, GeneratedClientMutations]>({
    mutations,
    onLiveError: options.onLiveError,
    roots,
    transport: createTRPCTransport<AppRouter, typeof trpcMutations>({
      byId: {
${byIdBlock}
      },
      client: trpcClient,
${queriesBlock}${listsBlock}${liveBlock}      mutations: trpcMutations,
    }),
    types: ${typesBlock.trimStart()},
  });
};
`;
};

const lowerTypeName = (type: string) => type[0]?.toLowerCase() + type.slice(1);

const createNativeClientSource = ({
  moduleExports,
  moduleName,
}: {
  moduleExports: ModuleExports;
  moduleName: string;
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

  return `// @generated by @nkzw/fate/vite
import type { ${importedTypes.join(', ')} } from '${moduleName}';
import { clientRoot, createClient, createHTTPTransport, mutation, type InferFateAPI } from 'react-fate';

type FateAPI = InferFateAPI<typeof fateServer>;

const mutations = {
${mutationConfigBlock}
} as const;

const roots = {
${rootBlock}
} as const;

type GeneratedClientMutations = typeof mutations;
type GeneratedClientRoots = typeof roots;

declare module 'react-fate' {
  interface ClientMutations extends GeneratedClientMutations {}
  interface ClientRoots extends GeneratedClientRoots {}
}

export const createFateClient = (options: {
  fetch?: typeof fetch;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  liveRetryMs?: number;
  liveUrl?: string | URL;
  onLiveError?: (error: unknown) => void;
  url: string | URL;
}) =>
  createClient<[GeneratedClientRoots, GeneratedClientMutations]>({
    mutations,
    onLiveError: options.onLiveError,
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
  });
`;
};
