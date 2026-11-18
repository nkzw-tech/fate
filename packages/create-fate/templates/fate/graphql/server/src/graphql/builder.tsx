import SchemaBuilder from '@pothos/core';
import ComplexityPlugin from '@pothos/plugin-complexity';
import DirectivesPlugin from '@pothos/plugin-directives';
import PrismaPlugin from '@pothos/plugin-prisma';
import RelayPlugin from '@pothos/plugin-relay';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import { Kind, type ValueNode } from 'graphql';
import PrismaTypes, { getDatamodel } from '../prisma/pothos-types.ts';
import prisma from '../prisma/prisma.tsx';
import isAdmin from '../user/isAdmin.tsx';
import { Context } from './context.tsx';
import AuthDirectivesPlugin from './lib/authDirectives.tsx';
import decodeGlobalID from './lib/decodeGlobalID.tsx';
import encodeGlobalID from './lib/encodeGlobalID.tsx';

interface PothosTypes extends Partial<PothosSchemaTypes.UserSchemaTypes> {
  AuthScopes: {
    role: string;
    self: string;
  };
  Context: Context;
  PrismaTypes: PrismaTypes;
  Scalars: {
    DateTime: {
      Input: Date | string;
      Output: Date | string;
    };
    JSON: {
      Input: unknown;
      Output: unknown;
    };
  };
}

const builder = new SchemaBuilder<PothosTypes>({
  complexity: {
    defaultComplexity: 1,
    defaultListMultiplier: 10,
    limit: {
      breadth: 300,
      complexity: 20_000,
      depth: 20,
    },
  },
  directives: {
    useGraphQLToolsUnorderedDirectives: true,
  },
  plugins: [
    ScopeAuthPlugin,
    ComplexityPlugin,
    PrismaPlugin,
    RelayPlugin,
    AuthDirectivesPlugin,
    DirectivesPlugin,
  ],
  prisma: {
    client: prisma,
    dmmf: getDatamodel(),
    exposeDescriptions: false,
    filterConnectionTotalCount: true,
    maxConnectionSize: 120,
    onUnusedQuery: process.env.NODE_ENV === 'production' ? null : 'error',
  },
  relay: {
    clientMutationId: 'omit',
    cursorType: 'String',
    decodeGlobalID,
    encodeGlobalID: (typename, id) => encodeGlobalID(typename as keyof PrismaTypes, id),
  },
  scopeAuth: {
    authScopes: ({ sessionUser }) => ({
      role: (role) =>
        !!sessionUser && (sessionUser.role.split(',').includes(role) || isAdmin(sessionUser)),
      self: (id) => !!sessionUser && id === sessionUser.id,
    }),
  },
});

builder.mutationType();
builder.queryType();
builder.subscriptionType();

type JSONLiteral =
  | boolean
  | number
  | string
  | null
  | Array<JSONLiteral>
  | { [key: string]: JSONLiteral };
const parseJSONLiteral = (ast: ValueNode): JSONLiteral => {
  switch (ast.kind) {
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.FLOAT:
    case Kind.INT:
      return Number(ast.value);
    case Kind.LIST:
      return ast.values.map(parseJSONLiteral);
    case Kind.NULL:
      return null;
    case Kind.OBJECT:
      return Object.fromEntries(
        ast.fields.map((field) => [field.name.value, parseJSONLiteral(field.value)]),
      );
    case Kind.STRING:
    case Kind.ENUM:
      return ast.value;
    default:
      return null;
  }
};

const isDate = (value: unknown): value is Date =>
  Object.prototype.toString.call(value) === '[object Date]';

export const DateTimeScalar = builder.scalarType('DateTime', {
  parseLiteral: (ast) => (ast.kind === Kind.STRING ? ast.value : ''),
  parseValue: (value) => (typeof value === 'string' || isDate(value) ? value : String(value)),
  serialize: (value) => (isDate(value) ? value.toISOString() : value),
});

export const JSONScalar = builder.scalarType('JSON', {
  parseLiteral: parseJSONLiteral,
  parseValue: (value) => value,
  serialize: (value) => value,
});

export default builder;
