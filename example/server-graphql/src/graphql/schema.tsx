import { writeFileSync } from 'node:fs';
import './schemaImportMap.tsx';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import {
  DirectiveLocation,
  GraphQLBoolean,
  GraphQLDirective,
  GraphQLString,
  specifiedDirectives,
} from 'graphql';
import builder from './builder.tsx';

const schema = builder.toSchema({
  directives: [
    ...specifiedDirectives,
    new GraphQLDirective({
      args: { role: { type: GraphQLString }, self: { type: GraphQLBoolean } },
      locations: [
        DirectiveLocation.FIELD_DEFINITION,
        DirectiveLocation.OBJECT,
        DirectiveLocation.INTERFACE,
      ],
      name: 'auth',
    }),
  ],
});

if (process.env.NODE_ENV === 'development') {
  writeFileSync(
    new URL('./schema.graphql', import.meta.url),
    printSchemaWithDirectives(schema),
    'utf8',
  );
}
export default schema;
