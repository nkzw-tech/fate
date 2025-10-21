export type TypeName = string;
export type EntityId = string;

export declare const __fate: unique symbol;
export type FragmentRef<TName extends string> = {
  readonly [__fate]: TName;
  readonly __typename: TName;
  readonly id: EntityId;
};

export type RelationDescriptor =
  | 'scalar'
  | { type: string }
  | { listOf: string };

export type EntityConfig = {
  fields?: Record<string, RelationDescriptor>;
  key: (record: unknown) => string | number;
  type: string;
};

export type PageInfo = { endCursor?: string; hasNextPage: boolean };

export type Entity = { __typename: string };

export type Selection<T extends Entity> = {
  [K in keyof T]?: T[K] extends Array<infer U extends Entity>
    ? true | Selection<U>
    : T[K] extends Entity | null
      ? true | Selection<NonNullable<T[K]>>
      : true;
};

export type Fragment<
  T extends Entity,
  S extends Selection<T> | undefined = undefined,
> = Readonly<{
  select: S;
}> & {
  readonly __typename?: T['__typename'];
};

export type FragmentData<T extends Entity, S extends Selection<T>> =
  S extends Selection<T> ? Mask<T, S> : T;

export type Mask<T, S> = S extends true
  ? T
  : S extends object
    ? {
        [K in keyof S]: S[K] extends true
          ? NonNullable<T>[Extract<K, keyof T>]
          : Mask<NonNullable<T>[Extract<K, keyof T>], Extract<S[K], object>>;
      }
    : T;

export type ListItem = Readonly<{
  args: unknown;
  fields?: ReadonlyArray<string>;
  type: string;
}>;

export type NodeItem = Readonly<{
  fields?: ReadonlyArray<string>;
  ids: ReadonlyArray<string | number>;
  type: string;
}>;

export type Query = Record<string, ListItem | NodeItem>;
