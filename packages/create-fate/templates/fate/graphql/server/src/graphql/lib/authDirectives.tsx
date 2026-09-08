import SchemaBuilder, {
  BasePlugin,
  PothosOutputFieldConfig,
  PothosTypeConfig,
  SchemaTypes,
} from '@pothos/core';
import { FieldAuthScopes, TypeAuthScopes } from '@pothos/plugin-scope-auth';

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

    if (!authScopes) {
      return fieldConfig;
    }

    const scopes = this.#resolveScopes(authScopes);

    return {
      ...fieldConfig,
      extensions: {
        ...fieldConfig.extensions,
        directives: {
          ...(fieldConfig.extensions?.directives as Record<string, unknown>),
          auth: scopes,
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
      !typeConfig.pothosOptions.authScopes
    ) {
      return typeConfig;
    }

    const scopes = this.#resolveScopes(typeConfig.pothosOptions.authScopes);

    return {
      ...typeConfig,
      extensions: {
        ...typeConfig.extensions,
        directives: {
          ...(typeConfig.extensions?.directives as Record<string, unknown>),
          auth: scopes,
        },
      },
    };
  }

  #resolveScopes(
    authScopes:
      | FieldAuthScopes<Types, object, Record<string, unknown>>
      | TypeAuthScopes<SchemaTypes, object>,
  ) {
    if (typeof authScopes !== 'function') {
      return authScopes;
    }

    try {
      const resolved = authScopes({}, {}, {}, {} as never);

      if (typeof resolved !== 'object' || !resolved) {
        return {};
      }

      return Object.fromEntries(
        Object.entries(resolved).map(([key, value]) => [key, value === undefined ? true : value]),
      );
    } catch {
      return {};
    }
  }
}

SchemaBuilder.registerPlugin('authDirectives', AuthDirectivesPlugin);

export default 'authDirectives';
