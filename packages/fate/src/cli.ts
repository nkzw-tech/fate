#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { styleText } from 'node:util';
import { createSchema } from './codegen/schema.ts';

const root = process.cwd();
const [, , command, moduleName, targetFile] = process.argv;

if (command !== 'generate' || !moduleName || !targetFile) {
  console.error(
    `${styleText('bold', 'Usage:')} ${styleText('blue', `pnpm fate generate <moduleName> <targetFile>`)}

Generates the fate client from the server's tRPC router.

  ${styleText('dim', '<moduleName>')}  The module name to import the tRPC router from.
  ${styleText('dim', '<targetFile>')}  The file path to write the generated client to.
  
  ${styleText('bold', 'Example:')} ${styleText('blue', `pnpm fate generate @org/server/trpc/router.ts client/lib/fate.ts`)}
`,
  );
  process.exit(1);
}

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

const generate = async () => {
  console.log(styleText('bold', `Generating fate client…\n`));

  const { appRouter, Lists, ...dataViews } = await import(moduleName);

  const { entities, types } = createSchema(Object.values(dataViews), Lists);

  const routerRecord = (appRouter as any)._def?.record ?? {};

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
  }> = [];

  for (const [router, procedures] of Object.entries(routerRecord)) {
    const entity = (
      entities as Record<string, { list?: string; listProcedure?: string; type: string }>
    )[router];
    if (!entity) {
      continue;
    }

    for (const [procedureName, procedure] of Object.entries(procedures as Record<string, any>)) {
      const type = procedure?._def?.type;
      if (!type) {
        continue;
      }

      if (type === 'mutation') {
        mutationEntries.push({
          entityType: entity.type,
          name: `${router}.${procedureName}`,
          procedure: procedureName,
          router,
        });
        continue;
      }

      if (procedureName === 'byId' && type === 'query') {
        byIdEntries.push({ entityType: entity.type, router });
        continue;
      }

      const listProcedure = entity.listProcedure ?? 'list';
      if (procedureName === listProcedure && type === 'query' && entity.list) {
        listEntries.push({
          list: entity.list,
          procedure: listProcedure,
          router,
        });
      }
    }
  }

  mutationEntries.sort((a, b) => a.name.localeCompare(b.name));
  byIdEntries.sort((a, b) => a.entityType.localeCompare(b.entityType));
  listEntries.sort((a, b) => a.list.localeCompare(b.list));

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
  const listsBlockContent = listLines.join('\n');
  const listsBlock = listLines.length
    ? `      lists: {\n${indentBlock(listsBlockContent, 8)}\n      },\n`
    : '';

  const source = `// @generated by \`pnpm fate generate\`
${typeImports}
import { createTRPCProxyClient } from '@trpc/client';
import { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { createClient, createTRPCTransport, mutation } from 'react-fate';

type TRPCClientType = ReturnType<typeof createTRPCProxyClient<AppRouter>>;
type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;

const mutations = {
${mutationConfigBlock}
} as const;

type GeneratedClientMutations = typeof mutations;

declare module 'react-fate' {
  interface ClientMutations extends GeneratedClientMutations {}
}

export const createFateClient = (options: {
  links: Parameters<typeof createTRPCProxyClient>[0]['links'];
}) => {
  const trpcClient = createTRPCProxyClient<AppRouter>(options);

  const trpcMutations = {
${mutationResolverBlock}
  } as const;

  return createClient({
    mutations,
    transport: createTRPCTransport<AppRouter, typeof trpcMutations>({
      byId: {
${byIdBlock}
      },
      client: trpcClient,
${listsBlock}      mutations: trpcMutations,
    }),
    types: ${typesBlock.trimStart()},
  });
};
`;

  const outputPath = path.join(root, targetFile);
  writeFileSync(outputPath, source);
  console.log(
    styleText('green', `  \u2713 fate client generated at '${path.relative(root, outputPath)}'.`),
  );
};

await generate();
