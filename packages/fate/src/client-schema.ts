import type { FateClient } from './client.ts';
import type { DataView, RawDataViewResult, ViewFieldConfig } from './data-view.ts';
import type { FateMutations, MutationOptions } from './mutation.ts';
import { isRecord } from './record.ts';
import type {
  AnyRecord,
  Entity,
  FateRoots,
  MutationDefinition,
  MutationInput,
  MutationEntity,
  MutationResult,
  RootDefinition,
  View,
  ViewData,
  ViewEntity,
  ViewEntityName,
  ViewSelection,
} from './types.ts';
import { MutationKind } from './types.ts';

export declare const ClientDefinition: unique symbol;
export declare const ClientEntities: unique symbol;
export type ClientDefinitionOf<C> = C extends { readonly [ClientDefinition]: infer D } ? D : never;
export type ClientDefinitionShape = {
  hydrationScope: string;
  mutations: FateMutations;
  roots: FateRoots;
};

/** A stored client type or fields added to an existing server type. */
export type ClientTypeDefinition = {
  defaults: (id: string | number) => AnyRecord;
  view: DataView<any>;
};

type ClientQueryReader = <V extends View<any, any>>(
  view: V,
  type: ViewEntityName<NoInfer<V>>,
  id: string | number,
) => ViewData<ViewEntity<V>, ViewSelection<V>> | null;

type ClientQuery<Type extends string, Args extends AnyRecord> = {
  args?: { parse(value: unknown): Args };
  resolve(context: { args: Args; read: ClientQueryReader }): string | number | null;
  type: Type;
};

/** Define a client root that selects a record by its ID. Return null when there is no match. */
export function clientQuery<
  const Type extends string,
  Args extends AnyRecord = Record<never, never>,
>(type: Type, definition: Omit<ClientQuery<Type, Args>, 'type'>): ClientQuery<Type, Args> {
  return { ...definition, type };
}

/** Define a client root accepting a string or finite numeric ID, returning null for missing records. */
clientQuery.byId = <const Type extends string>(
  type: Type,
): ClientQuery<Type, { id: string | number }> =>
  clientQuery(type, {
    args: {
      parse(value: unknown) {
        if (
          !isRecord(value) ||
          (typeof value.id !== 'string' &&
            (typeof value.id !== 'number' || !Number.isFinite(value.id)))
        ) {
          throw new Error('fate: A by-ID client query requires a string or finite numeric id.');
        }
        return { id: value.id };
      },
    },
    resolve: ({ args }) => args.id,
  });

export type ClientRoot = { id: string | number; type: string } | ClientQuery<string, any>;

export type ClientSchema = {
  roots?: Record<string, ClientRoot>;
  typeExtensions?: Record<string, ClientTypeDefinition>;
  types?: Record<string, ClientTypeDefinition>;
};

/** Declare client data with the same dataView, list, field and memo definitions as the server. */
export function clientSchema<const S extends ClientSchema>(schema: S): S {
  return schema;
}

type Definitions<S extends ClientSchema> = (S extends { types: infer T }
  ? T
  : Record<never, never>) &
  (S extends { typeExtensions: infer E } ? E : Record<never, never>);
type ViewName<S extends ClientSchema, V> =
  V extends DataView<infer Item>
    ? Item extends { __typename: infer Name extends string }
      ? Name
      : RegisteredViewName<S, V>
    : never;
type RegisteredViewName<S extends ClientSchema, V> = {
  [K in keyof Definitions<S>]: Definitions<S>[K] extends { view: infer Candidate }
    ? V extends Candidate
      ? K & string
      : never
    : never;
}[keyof Definitions<S>];
type LocalViewResult<S extends ClientSchema, V extends DataView<any>> = {
  [K in keyof RawDataViewResult<V>]: K extends keyof ViewFieldConfig<V>
    ? ViewFieldConfig<V>[K] extends infer Child extends DataView<any>
      ?
          | (NonNullable<RawDataViewResult<V>[K]> extends ReadonlyArray<unknown>
              ? Array<LocalViewResult<S, Child> & { __typename: ViewName<S, Child> }>
              : LocalViewResult<S, Child> & { __typename: ViewName<S, Child> })
          | Extract<RawDataViewResult<V>[K], null | undefined>
      : RawDataViewResult<V>[K]
    : RawDataViewResult<V>[K];
};
type LocalEntity<
  S extends ClientSchema,
  K extends keyof Definitions<S>,
> = Definitions<S>[K] extends { view: infer V extends DataView<any> }
  ? LocalViewResult<S, V> & { __typename: K & string; id: string | number }
  : never;

/** Recursively add client fields, including through server relationships. */
export type WithClientFields<
  T,
  S extends ClientSchema,
  Depth extends Array<unknown> = [],
> = 0 extends 1 & T
  ? T
  : T extends Date
    ? T
    : T extends ReadonlyArray<infer Item>
      ? Array<WithClientFields<Item, S, [...Depth, 0]>>
      : T extends { __typename: infer Name extends string }
        ? {
            [
              K in keyof (T & (Name extends keyof Definitions<S> ? LocalEntity<S, Name> : unknown))
            ]: Name extends keyof Definitions<S>
              ? Definitions<S>[Name] extends { view: infer V extends DataView<any> }
                ? K extends keyof ViewFieldConfig<V> & keyof LocalEntity<S, Name>
                  ? ViewFieldConfig<V>[K] extends true | { kind: 'computed' }
                    ? LocalEntity<S, Name>[K]
                    : WithClientFields<LocalEntity<S, Name>[K], S, [...Depth, 0]>
                  : K extends keyof T
                    ? WithClientFields<T[K], S, [...Depth, 0]>
                    : never
                : never
              : K extends keyof T
                ? WithClientFields<T[K], S, [...Depth, 0]>
                : never;
          }
        : T extends object
          ? { [K in keyof T]: WithClientFields<T[K], S, [...Depth, 0]> }
          : T;

type RootResult<R> = R extends RootDefinition<any, infer Result, any> ? Result : never;
type FindEntities<T, Depth extends Array<unknown> = []> = 0 extends 1 & T
  ? never
  : Depth['length'] extends 4
    ? never
    : T extends ReadonlyArray<infer Item>
      ? FindEntities<Item, [...Depth, 0]>
      : T extends object
        ?
            | (T extends Entity ? T : never)
            | { [K in keyof T]: FindEntities<T[K], [...Depth, 0]> }[keyof T]
        : never;

type RemoteEntities<R extends FateRoots, M extends FateMutations> =
  | FindEntities<MutationEntity<M[keyof M]>>
  | Exclude<
      FindEntities<RootResult<R[keyof R]>>,
      {
        __typename: FindEntities<MutationEntity<M[keyof M]>> extends infer E extends Entity
          ? E['__typename']
          : never;
      }
    >;

type SchemaEntities<R extends FateRoots, S extends ClientSchema, M extends FateMutations> = {
  [E in RemoteEntities<R, M> as E extends Entity ? E['__typename'] : never]: WithClientFields<E, S>;
} & {
  [K in keyof Definitions<S>]: Extract<RemoteEntities<R, M>, { __typename: K }> extends never
    ? LocalEntity<S, K>
    : WithClientFields<Extract<RemoteEntities<R, M>, { __typename: K }>, S>;
};

export type ExtendedRoots<R extends FateRoots, S extends ClientSchema> = {
  [K in keyof R]: R[K] extends RootDefinition<infer Name, infer Result, infer Args>
    ? RootDefinition<Name, WithClientFields<Result, S>, Args>
    : R[K];
} & {
  [K in keyof S['roots']]: NonNullable<S['roots']>[K] extends {
    type: infer Name extends keyof Definitions<S> & string;
  }
    ? NonNullable<S['roots']>[K] extends ClientQuery<Name, infer Args>
      ? RootDefinition<Name, LocalEntity<S, Name> | null, Args>
      : RootDefinition<Name, LocalEntity<S, Name>, Record<never, never>>
    : never;
};

/** Look up an entity type by name on the configured client. */
export type EntityOf<C, Name extends string> = C extends {
  readonly [ClientEntities]: infer Entities;
}
  ? Name extends keyof Entities
    ? Entities[Name]
    : never
  : ClientDefinitionOf<C> extends { roots: infer R extends FateRoots }
    ? Extract<FindEntities<RootResult<R[keyof R]>>, { __typename: Name }>
    : never;

type StoredKeys<S extends ClientSchema, N extends PropertyKey> = N extends keyof Definitions<S>
  ? Definitions<S>[N] extends { view: infer V extends DataView<any> }
    ? {
        [K in keyof ViewFieldConfig<V>]: ViewFieldConfig<V>[K] extends { kind: 'computed' }
          ? never
          : K;
      }[keyof ViewFieldConfig<V>]
    : never
  : never;
type WritableValue<T> =
  T extends ReadonlyArray<unknown>
    ? { [K in keyof T]: WritableValue<T[K]> }
    : T extends Entity
      ? { __typename?: T['__typename']; id: string | number } & Partial<{
          [K in keyof T]: WritableValue<T[K]>;
        }>
      : T;
type ClientPatch<Entities, S extends ClientSchema, N extends keyof Entities> = {
  [K in Extract<StoredKeys<S, N>, Exclude<keyof Entities[N], 'id' | '__typename'>>]?: WritableValue<
    Entities[N][K]
  >;
};

type ListKeys<S extends ClientSchema, N extends PropertyKey> = N extends keyof Definitions<S>
  ? Definitions<S>[N] extends { view: infer V extends DataView<any> }
    ? {
        [K in keyof ViewFieldConfig<V>]: ViewFieldConfig<V>[K] extends { kind: 'list' } ? K : never;
      }[keyof ViewFieldConfig<V>]
    : never
  : never;

type ListMemberId<T> =
  NonNullable<T> extends ReadonlyArray<{ id: infer Id extends string | number }> ? Id : never;

export type ClientStore<Entities, S extends ClientSchema> = {
  /** Append existing entities by ID without materializing the list. Duplicate IDs keep their position. */
  append<
    N extends keyof Entities & string,
    K extends Extract<ListKeys<S, NoInfer<N>>, keyof Entities[N] & string>,
  >(
    type: N,
    id: string | number,
    field: K,
    ...ids: Array<ListMemberId<Entities[N][K]>>
  ): void;
  create<N extends keyof NonNullable<S['types']> & keyof Entities & string>(
    type: N,
    data: ClientPatch<Entities, S, N> & { id: string | number },
  ): Partial<Entities[N]> & { __typename: N; id: string | number };
  delete<N extends keyof NonNullable<S['types']> & string>(type: N, id: string | number): void;
  get<N extends keyof Entities & string>(
    type: N,
    id: string | number,
  ): Readonly<Partial<Entities[N]>> | undefined;
  has<N extends keyof Entities & string>(type: N, id: string | number): boolean;
  /** Remove list membership by ID without deleting the entities. Missing members are ignored. */
  remove<
    N extends keyof Entities & string,
    K extends Extract<ListKeys<S, NoInfer<N>>, keyof Entities[N] & string>,
  >(
    type: N,
    id: string | number,
    field: K,
    ...ids: Array<ListMemberId<Entities[N][K]>>
  ): void;
  update<N extends keyof Entities & string>(
    type: N,
    id: string | number,
    patch: ClientPatch<Entities, S, N>,
  ): Partial<Entities[N]> & { id: string | number };
};

export type ClientMutationContext<
  Entities,
  M extends FateMutations,
  I,
  S extends ClientSchema = ClientSchema,
> = {
  input: I;
  /** Execute and stage a remote response. Local changes publish only after the resolver succeeds. */
  mutateRemote<K extends keyof M & string>(
    key: K,
    input: Omit<MutationInput<M[K]>, 'select'>,
    options?: Pick<MutationOptions<M[K] & { key: K }>, 'args' | 'select' | 'view'>,
  ): Promise<MutationResult<M[K]>>;
  store: ClientStore<Entities, S>;
};

export type ClientMutationDefinition = {
  entity: string;
  input?: { parse(value: unknown): any };
  [MutationKind]: true;
  resolve: (context: ClientMutationContext<any, any, any, any>) => unknown;
};

type ClientInputParser = { parse(value: unknown): any };
type ClientInput<P extends ClientInputParser> = P extends {
  readonly '~standard': { readonly types?: { readonly input: infer Input } };
}
  ? Input
  : ReturnType<P['parse']>;

export type ClientMutationBuilder<
  R extends FateRoots,
  M extends FateMutations,
  S extends ClientSchema,
> = {
  mutation<N extends keyof SchemaEntities<R, S, M> & string, Result>(
    type: N,
    definition: {
      input?: never;
      resolve: (
        context: ClientMutationContext<SchemaEntities<R, S, M>, M, Record<never, never>, S>,
      ) => Result;
    },
  ): MutationDefinition<
    Extract<SchemaEntities<R, S, M>[N], Entity>,
    Record<never, never>,
    Awaited<Result>
  > &
    ClientMutationDefinition;
  mutation<N extends keyof SchemaEntities<R, S, M> & string, P extends ClientInputParser, Result>(
    type: N,
    definition: {
      input: P;
      resolve: (
        context: ClientMutationContext<SchemaEntities<R, S, M>, M, ReturnType<P['parse']>, S>,
      ) => Result;
    },
  ): MutationDefinition<
    Extract<SchemaEntities<R, S, M>[N], Entity>,
    ClientInput<P>,
    Awaited<Result>
  > &
    ClientMutationDefinition;
};

export type ExtendedClient<
  R extends FateRoots,
  M extends FateMutations,
  H extends string,
  S extends ClientSchema,
  Added extends FateMutations,
> = FateClient<ExtendedRoots<R, S>, M & Added, H> & {
  readonly [ClientEntities]: SchemaEntities<R, S, M>;
};

/** Name a configured client without referring to the return type of its factory. */
export type ClientOf<
  S extends ClientSchema,
  Added extends FateMutations = Record<never, never>,
  Base extends { readonly [ClientDefinition]: ClientDefinitionShape } = FateClient<
    Record<never, never>,
    Record<never, never>
  >,
> = ExtendedClient<
  ClientDefinitionOf<Base>['roots'],
  ClientDefinitionOf<Base>['mutations'],
  ClientDefinitionOf<Base>['hydrationScope'],
  S,
  Added
>;

export const clientMutationBuilder = {
  mutation: (
    entity: string,
    definition: Omit<ClientMutationDefinition, 'entity' | typeof MutationKind>,
  ) => ({
    ...definition,
    entity,
    [MutationKind]: true,
  }),
};

/** Register the configured client once to type ordinary React and Vue hooks. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ClientRegistration {}

export type RegisteredClient<Fallback> = ClientRegistration extends { client: infer C }
  ? C
  : Fallback;
