import { isRecord } from './record.ts';
import type { RelationDescriptor } from './types.ts';

export type GraphQLArgument = Readonly<{ hasDefault?: boolean; type: string }>;
export type GraphQLArguments = Readonly<Record<string, GraphQLArgument>>;

export type GraphQLByIdConfig = Readonly<{ field: string; idArg?: string }>;

export const validateGraphQLRefetchMappings = (
  byId: Readonly<Record<string, GraphQLByIdConfig>> | undefined,
  schema?: GraphQLArgumentSchema,
) => {
  for (const [type, { field, idArg = 'id' }] of Object.entries(byId ?? {})) {
    for (const name of [type, field, idArg]) {
      if (!/^[_A-Za-z][_0-9A-Za-z]*$/.test(name)) {
        throw new Error(`fate(graphql): Invalid refetch identifier '${name}'.`);
      }
    }
    if (!schema) {
      continue;
    }
    const path = `${schema.queryType}.${field}`;
    const args = schema.fields[schema.queryType]?.[field];
    if (!args) {
      throw new Error(`fate(graphql): Unknown refetch field '${path}'.`);
    }
    if (!args[idArg] || !/^(ID|String|Int)!?$/.test(args[idArg].type)) {
      throw new Error(
        `fate(graphql): Refetch argument '${path}.${idArg}' must accept one ID, String, or Int.`,
      );
    }
    for (const [name, arg] of Object.entries(args)) {
      if (name !== idArg && arg.type.endsWith('!') && !arg.hasDefault) {
        throw new Error(
          `fate(graphql): Refetch field '${path}' requires unsupported argument '${name}'.`,
        );
      }
    }
    const output = schema.outputs?.[schema.queryType]?.[field];
    if (schema.outputs && (output?.replace(/!$/, '') !== type || !schema.outputs[type]?.id)) {
      throw new Error(`fate(graphql): Refetch field '${path}' must return one '${type}' entity.`);
    }
  }
};

/** Build-time schema metadata needed to validate inputs and declare wire variables. */
export type GraphQLArgumentSchema = Readonly<{
  fields: Readonly<Record<string, Readonly<Record<string, GraphQLArguments>>>>;
  inputs: Readonly<
    Record<
      string,
      | Readonly<{ kind: 'enum'; values: ReadonlyArray<string> }>
      | Readonly<{ fields: GraphQLArguments; kind: 'object' }>
    >
  >;
  mutationType?: string;
  outputs?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  possibleTypes?: Readonly<Record<string, ReadonlyArray<string>>>;
  queryType: string;
  scalars?: ReadonlyArray<string>;
  subscriptionType?: string;
  unions?: Readonly<Record<string, ReadonlyArray<string>>>;
}>;

/** Infer relation storage shapes from GraphQL output types. */
const baseGraphQLType = (type: string) => type.replaceAll(/[![\]]/g, '');

export const graphQLOutputRelations = (
  schema: GraphQLArgumentSchema | undefined,
): Array<{
  fields: Record<string, RelationDescriptor>;
  possibleTypes?: ReadonlyArray<string>;
  type: string;
}> => {
  const outputs = schema?.outputs ?? {};
  return Object.entries(outputs).map(([type, outputFields]) => {
    const fields: Record<string, RelationDescriptor> = {};
    for (const [field, outputType] of Object.entries(outputFields)) {
      const childType = baseGraphQLType(outputType);
      if (!outputs[childType]) {
        continue;
      }
      if (outputs[childType].edges && outputs[childType].pageInfo) {
        const edgeType = baseGraphQLType(outputs[childType].edges);
        const nodeType = outputs[edgeType]?.node;
        if (nodeType) {
          fields[field] = { listOf: baseGraphQLType(nodeType) };
          continue;
        }
      }
      const array = outputType.replaceAll('!', '').startsWith('[');
      const possibleTypes = schema?.possibleTypes?.[childType];
      if (outputs[childType].id) {
        fields[field] = array
          ? { array: true, listOf: childType, ...(possibleTypes ? { possibleTypes } : {}) }
          : { type: childType, ...(possibleTypes ? { possibleTypes } : {}) };
      } else {
        fields[field] = array ? { array: true, embedded: childType } : { embedded: childType };
      }
    }
    const possibleTypes = schema?.possibleTypes?.[type];
    return { fields, ...(possibleTypes ? { possibleTypes } : {}), type };
  });
};

const invalidInput = (path: string, type: string): never => {
  throw new Error(`fate(graphql): Invalid input '${path}'; expected ${type}.`);
};

export const validateGraphQLInput = (
  schema: GraphQLArgumentSchema,
  type: string,
  value: unknown,
  path: string,
): unknown => {
  if (value == null) {
    return type.endsWith('!') ? invalidInput(path, type) : null;
  }
  const nullableType = type.endsWith('!') ? type.slice(0, -1) : type;
  if (nullableType.startsWith('[')) {
    const itemType = nullableType.slice(1, -1);
    return (Array.isArray(value) ? value : [value]).map((item, index) =>
      validateGraphQLInput(schema, itemType, item, `${path}[${index}]`),
    );
  }
  const input = schema.inputs[nullableType];
  if (input?.kind === 'enum') {
    return typeof value === 'string' && input.values.includes(value)
      ? value
      : invalidInput(path, type);
  }
  if (input?.kind === 'object') {
    if (!isRecord(value)) {
      return invalidInput(path, type);
    }
    return validateGraphQLArguments(schema, input.fields, value, path);
  }
  switch (nullableType) {
    case 'Boolean':
      return typeof value === 'boolean' ? value : invalidInput(path, type);
    case 'String':
      return typeof value === 'string' ? value : invalidInput(path, type);
    case 'ID':
      return typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value))
        ? value
        : invalidInput(path, type);
    case 'Int':
      return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= -2_147_483_648 &&
        value <= 2_147_483_647
        ? value
        : invalidInput(path, type);
    case 'Float':
      return typeof value === 'number' && Number.isFinite(value) ? value : invalidInput(path, type);
    default:
      return value;
  }
};

export const validateGraphQLArguments = (
  schema: GraphQLArgumentSchema,
  definitions: GraphQLArguments,
  values: Readonly<Record<string, unknown>> | undefined,
  path: string,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(values ?? {})) {
    if (!Object.hasOwn(definitions, key)) {
      throw new Error(`fate(graphql): Unknown argument '${path}.${key}'.`);
    }
  }
  for (const [key, definition] of Object.entries(definitions)) {
    const value = values?.[key];
    if (value === undefined) {
      if (definition.type.endsWith('!') && !definition.hasDefault) {
        invalidInput(`${path}.${key}`, definition.type);
      }
      continue;
    }
    result[key] = validateGraphQLInput(schema, definition.type, value, `${path}.${key}`);
  }
  return result;
};
