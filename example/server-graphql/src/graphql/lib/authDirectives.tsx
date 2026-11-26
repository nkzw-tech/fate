import { isRecord } from '@nkzw/fate/server';
import SchemaBuilder, {
  BasePlugin,
  PothosOutputFieldConfig,
  PothosTypeConfig,
  SchemaTypes,
} from '@pothos/core';

const directives = (value: unknown) => (isRecord(value) ? value : undefined);

declare global {
  export namespace PothosSchemaTypes {
    export interface Plugins<Types extends SchemaTypes> {
      authDirectives: AuthDirectivesPlugin<Types>;
    }
  }
}

export class AuthDirectivesPlugin<Types extends SchemaTypes> extends BasePlugin<Types> {
  override onOutputFieldConfig(
    fieldConfig: PothosOutputFieldConfig<Types>,
  ): PothosOutputFieldConfig<Types> | null {
    const { authScopes } = fieldConfig.pothosOptions;

    // Request-dependent scopes declare their directive alongside the resolver.
    if (!authScopes || typeof authScopes === 'function') {
      return fieldConfig;
    }

    return {
      ...fieldConfig,
      extensions: {
        ...fieldConfig.extensions,
        directives: {
          ...directives(fieldConfig.extensions?.directives),
          auth: authScopes,
        },
      },
    };
  }

  override onTypeConfig(typeConfig: PothosTypeConfig): PothosTypeConfig {
    if (
      typeConfig.kind === 'Enum' ||
      typeConfig.kind === 'Scalar' ||
      typeConfig.kind === 'InputObject' ||
      typeConfig.kind === 'Union' ||
      !typeConfig.pothosOptions.authScopes ||
      typeof typeConfig.pothosOptions.authScopes === 'function'
    ) {
      return typeConfig;
    }

    return {
      ...typeConfig,
      extensions: {
        ...typeConfig.extensions,
        directives: {
          ...directives(typeConfig.extensions?.directives),
          auth: typeConfig.pothosOptions.authScopes,
        },
      },
    };
  }
}

SchemaBuilder.registerPlugin('authDirectives', AuthDirectivesPlugin);

export default 'authDirectives';
