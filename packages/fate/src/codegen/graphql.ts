import { createRequire } from 'node:module';
import type { GraphQLInterfaceType, GraphQLSchema } from 'graphql';
import type { GraphQLArgumentSchema, GraphQLArguments } from '../graphqlSchema.ts';

const require = createRequire(import.meta.url);

const schemaFromSDL = (source: string): GraphQLSchema => {
  try {
    return (require('graphql') as typeof import('graphql')).buildSchema(source);
  } catch (error) {
    const directives =
      error instanceof Error
        ? [
            ...new Set(
              [...error.message.matchAll(/Unknown directive "(@[_A-Za-z][_0-9A-Za-z]*)"/g)].map(
                (match) => match[1],
              ),
            ),
          ]
        : [];
    if (directives.length) {
      throw new Error(
        `fate(graphql): SDL uses undeclared directives ${directives.join(', ')}. Declare them in the SDL, or pass a GraphQLSchema built with buildSchema(sdl, { assumeValidSDL: true }) when this is intentional.`,
        { cause: error },
      );
    }
    throw error;
  }
};

const argument = (value: { default?: unknown; defaultValue?: unknown; type: unknown }) => ({
  ...(value.default !== undefined || value.defaultValue !== undefined
    ? { hasDefault: true }
    : null),
  type: String(value.type),
});

/** Extracts serializable argument metadata without shipping GraphQL's schema implementation. */
export function createGraphQLArgumentSchema(source: string | GraphQLSchema): GraphQLArgumentSchema {
  const schema = typeof source === 'string' ? schemaFromSDL(source) : source;
  const queryType = schema.getQueryType()?.name;
  if (!queryType) {
    throw new Error('fate(graphql): The schema must have a query type.');
  }
  const fields: Record<string, Record<string, GraphQLArguments>> = {};
  const outputs: Record<string, Record<string, string>> = {};
  const possibleTypes: Record<string, Array<string>> = {};
  const scalars: Array<string> = [];
  const unions: Record<string, Array<string>> = {};
  const inputs: Record<string, GraphQLArgumentSchema['inputs'][string]> = {};
  for (const [name, type] of Object.entries(schema.getTypeMap()).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (name.startsWith('__')) {
      continue;
    }
    if ('getFields' in type && 'getInterfaces' in type) {
      if (type.constructor.name === 'GraphQLInterfaceType') {
        possibleTypes[name] = schema
          .getPossibleTypes(type as GraphQLInterfaceType)
          .map((possible) => possible.name);
      }
      outputs[name] = Object.fromEntries(
        Object.entries(type.getFields()).map(([fieldName, field]) => [
          fieldName,
          String(field.type),
        ]),
      );
      fields[name] = Object.fromEntries(
        Object.entries(type.getFields()).map(([name, field]) => [
          name,
          Object.fromEntries(field.args.map((arg) => [arg.name, argument(arg)])),
        ]),
      );
    } else if ('getTypes' in type) {
      unions[name] = type.getTypes().map(({ name }) => name);
    } else if ('getValues' in type) {
      inputs[name] = { kind: 'enum', values: type.getValues().map(({ name }) => name) };
    } else if ('getFields' in type) {
      inputs[name] = {
        fields: Object.fromEntries(
          Object.entries(type.getFields()).map(([name, field]) => [name, argument(field)]),
        ),
        kind: 'object',
      };
    } else {
      scalars.push(name);
    }
  }
  return {
    fields,
    inputs,
    mutationType: schema.getMutationType()?.name,
    outputs,
    possibleTypes,
    queryType,
    scalars,
    subscriptionType: schema.getSubscriptionType()?.name,
    unions,
  };
}

export type GraphQLScalarTypes = Readonly<
  Record<string, string | Readonly<{ input: string; output: string }>>
>;

export const graphQLTypeScriptType = (
  type: string,
  schema: GraphQLArgumentSchema,
  scalars: GraphQLScalarTypes = {},
): string => {
  const nonNull = type.endsWith('!');
  const name = nonNull ? type.slice(0, -1) : type;
  const value = name.startsWith('[')
    ? `ReadonlyArray<${graphQLTypeScriptType(name.slice(1, -1), schema, scalars)}>`
    : schema.inputs[name]
      ? `GraphQLInputs[${JSON.stringify(name)}]`
      : ((typeof scalars[name] === 'string' ? scalars[name] : scalars[name]?.input) ??
        {
          Boolean: 'boolean',
          Float: 'number',
          ID: 'string | number',
          Int: 'number',
          String: 'string',
        }[name] ??
        'unknown');
  return nonNull ? value : `${value} | null`;
};

export const graphQLArgumentsType = (
  args: GraphQLArguments,
  schema: GraphQLArgumentSchema,
  scalars: GraphQLScalarTypes = {},
): string => {
  const fields = Object.entries(args).map(
    ([name, arg]) =>
      `readonly ${JSON.stringify(name)}${arg.type.endsWith('!') && !arg.hasDefault ? '' : '?'}: ${graphQLTypeScriptType(arg.type, schema, scalars)};`,
  );
  return fields.length ? `{ ${fields.join(' ')} }` : 'Record<string, never>';
};

export const graphQLArgumentContracts = (
  schema: GraphQLArgumentSchema,
  scalars: GraphQLScalarTypes = {},
): string => `
export type GraphQLInputs = {
${Object.entries(schema.inputs)
  .map(
    ([name, input]) =>
      `  readonly ${JSON.stringify(name)}: ${input.kind === 'enum' ? input.values.map((value) => JSON.stringify(value)).join(' | ') : graphQLArgumentsType(input.fields, schema, scalars)};`,
  )
  .join('\n')}
};

export type GraphQLFieldArguments = {
${Object.entries(schema.fields)
  .map(
    ([type, fields]) =>
      `  readonly ${JSON.stringify(type)}: {\n${Object.entries(fields)
        .map(
          ([field, args]) =>
            `    readonly ${JSON.stringify(field)}: ${graphQLArgumentsType(args, schema, scalars)};`,
        )
        .join('\n')}\n  };`,
  )
  .join('\n')}
};
`;

const baseType = (type: string) => type.replaceAll(/[![\]]/g, '');

const connectionNode = (name: string, schema: GraphQLArgumentSchema) => {
  const fields = schema.outputs?.[name];
  const edge = fields?.edges && fields.pageInfo && schema.outputs?.[baseType(fields.edges)];
  return edge && edge.node ? baseType(edge.node) : undefined;
};

/** Generates schema contracts independently of the application's mapping module. */
export const createGraphQLSchemaSource = (
  source: string | GraphQLSchema | GraphQLArgumentSchema,
  scalars: GraphQLScalarTypes = {},
): string => {
  const schema =
    typeof source === 'object' && 'queryType' in source
      ? source
      : createGraphQLArgumentSchema(source);
  for (const name of Object.keys(scalars)) {
    if (!schema.scalars?.includes(name)) {
      throw new Error(`fate(graphql): Unknown scalar mapping '${name}'.`);
    }
  }
  const outputType = (type: string, map: string): string => {
    const nonNull = type.endsWith('!');
    const name = nonNull ? type.slice(0, -1) : type;
    const node = map !== 'GraphQLTypes' && connectionNode(name, schema);
    const value = name.startsWith('[')
      ? `Array<${outputType(name.slice(1, -1), map)}>`
      : node
        ? map === 'GraphQLEntities'
          ? `Array<${map}[${JSON.stringify(node)}]>`
          : `{ items: Array<{ cursor: string | undefined; node: ${map}[${JSON.stringify(node)}] }>; pagination: import('@nkzw/fate').Pagination }`
        : schema.outputs?.[name] || schema.unions?.[name]
          ? `${map}[${JSON.stringify(name)}]`
          : schema.inputs[name]?.kind === 'enum'
            ? `GraphQLInputs[${JSON.stringify(name)}]`
            : ((typeof scalars[name] === 'string' ? scalars[name] : scalars[name]?.output) ??
              {
                Boolean: 'boolean',
                Float: 'number',
                ID: 'string',
                Int: 'number',
                String: 'string',
              }[name] ??
              'unknown');
    return nonNull ? value : `${value} | null`;
  };
  const maps = ['GraphQLTypes', 'GraphQLEntities', 'GraphQLResponses']
    .map(
      (map) => `
export type ${map} = {
${Object.entries({
  ...schema.outputs,
  ...Object.fromEntries(Object.keys(schema.unions ?? {}).map((name) => [name, {}])),
})
  .map(([name, fields]) => {
    const possible = schema.unions?.[name] ?? schema.possibleTypes?.[name];
    const body = possible
      ? possible.map((type) => `${map}[${JSON.stringify(type)}]`).join(' | ') || 'never'
      : `{
    readonly __typename: ${JSON.stringify(name)};
${Object.entries(fields)
  .map(([field, type]) => `    readonly ${JSON.stringify(field)}: ${outputType(type, map)};`)
  .join('\n')}
  }`;
    return `  readonly ${JSON.stringify(name)}: ${body};`;
  })
  .join('\n')}
};
`,
    )
    .join('\n');
  return `// @generated by @nkzw/fate/vite\n${graphQLArgumentContracts(schema, scalars)}\n${maps}`;
};
