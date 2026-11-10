import { isRecord } from './record.ts';
import type { AnyRecord } from './types.ts';

const dataViewFieldsKey = Symbol('__fate__DataViewFields');
const dataViewBaseKey = Symbol('__fate__DataViewBase');
const dataViewListOptionsKey = Symbol('__fate__DataViewListOptions');

type ResolverSelect<Context> =
  | AnyRecord
  | ((options: { args?: AnyRecord; context?: Context }) => AnyRecord | void);

type Bivariant<Fn extends (...args: Array<any>) => unknown> = {
  bivariance(...args: Parameters<Fn>): ReturnType<Fn>;
}['bivariance'];

type ResolverResolve<Item extends AnyRecord, Result, Context> = Bivariant<
  (item: Item, context?: Context, args?: AnyRecord) => Promise<Result> | Result
>;

type ResolverAuthorize<Item extends AnyRecord, Context> = Bivariant<
  (item: Item, context?: Context, args?: AnyRecord) => Promise<boolean> | boolean
>;

type MemoFieldOptions = {
  args?: AnyRecord | ((args: AnyRecord) => AnyRecord);
};

export type FieldSelection<Path extends string = string> = MemoFieldOptions & {
  kind: 'field';
  path: Path;
};

type SQLWrapperLike = {
  getSQL: () => unknown;
};

export type CountWhere =
  | AnyRecord
  | SQLWrapperLike
  | ((columns: Record<string, any>) => SQLWrapperLike | undefined);

export type CountSelection = {
  kind: 'count';
  relation: string;
  where?: CountWhere;
};

export type MemoSelection = CountSelection | FieldSelection;

type MemoSelectInput = Record<string, MemoSelection | MemoFieldOptions | true>;
type NormalizeMemoSelection<Selection, Name extends string> = Selection extends MemoSelection
  ? Selection
  : FieldSelection<Name>;
type NormalizeMemoSelect<Select> = {
  [Key in keyof Select]: NormalizeMemoSelection<Select[Key], Key & string>;
};

type MemoPathValue<Item, Path extends string> = string extends Path
  ? unknown
  : Item extends null | undefined
    ? Item | undefined
    : Item extends ReadonlyArray<infer Entry>
      ? Array<MemoPathValue<Entry, Path>>
      : Path extends `${infer Name}.${infer Rest}`
        ? Name extends keyof Item
          ? MemoPathValue<Item[Name], Rest> | undefined
          : unknown
        : Path extends keyof Item
          ? Item[Path]
          : unknown;

type MemoDependency<Item, Selection> = Selection extends CountSelection
  ? number
  : Selection extends FieldSelection<infer Path>
    ? MemoPathValue<Item, Path>
    : unknown;

type MemoDeps<Item, Select extends Record<string, MemoSelection> | undefined> =
  Select extends Record<string, MemoSelection>
    ? { [Key in keyof Select]: MemoDependency<Item, Select[Key]> }
    : Record<string, unknown>;

type MemoResolve<
  Item extends AnyRecord,
  Result,
  Select extends Record<string, MemoSelection> | undefined,
  Context,
> = Bivariant<
  (
    item: Item,
    deps: MemoDeps<Item, Select>,
    context?: Context,
    args?: AnyRecord,
  ) => Promise<Result> | Result
>;

/**
 * Field configuration for selecting and resolving a value on the backend.
 */
export type ResolverField<Item extends AnyRecord, Result, Context> = {
  authorize?: ResolverAuthorize<Item, Context>;
  kind: 'resolver';
  resolve: ResolverResolve<Item, Result, Context>;
  select?: ResolverSelect<Context>;
};

export type MemoField<
  Item extends AnyRecord,
  Result,
  Context,
  Select extends Record<string, MemoSelection> | undefined = Record<string, MemoSelection>,
> = {
  authorize?: ResolverAuthorize<Item, Context>;
  /** @hidden */
  kind: 'computed';
  resolve: MemoResolve<Item, Result, Select, Context>;
  select?: Select;
};

export type DataField<Item extends AnyRecord> =
  | true
  | MemoField<Item, any, any, any>
  | DataView<AnyRecord>
  | ResolverField<Item, any, any>;

/**
 * Recursively serializes resolver results for transport across the network.
 */
export type Serializable<T> = T extends Date
  ? string
  : T extends Array<infer U>
    ? Array<Serializable<U>>
    : T extends object
      ? { [K in keyof T]: Serializable<T[K]> }
      : T;

/**
 * Server-side mirror of a view definition describing how to select and resolve
 * fields when fulfilling a client request.
 */
export type DataView<Item extends AnyRecord> = {
  fields: Record<string, DataField<Item>>;
  kind?: 'resolver' | 'list';
  typeName: string;
};

type DataViewInternals<Item extends AnyRecord> = {
  readonly [dataViewBaseKey]?: DataView<Item>;
  readonly [dataViewListOptionsKey]?: DataViewListOptions;
};

/**
 * Convenience type for declaring the fields of a server data view.
 */
export type DataViewConfig<Item extends AnyRecord> = Record<string, DataField<Item>>;

export type DataViewOrderDirection = 'asc' | 'desc';

export type DataViewOrderBy =
  | Record<string, DataViewOrderDirection>
  | Array<Record<string, DataViewOrderDirection>>;

export type DataViewListOptions = {
  orderBy?: DataViewOrderBy;
};

export const isDataView = (value: unknown): value is DataView<AnyRecord> =>
  isRecord(value) && isRecord(value.fields) && typeof value.typeName === 'string';

export const getBaseDataView = <Item extends AnyRecord>(view: DataView<Item>): DataView<Item> =>
  (view as DataView<Item> & DataViewInternals<Item>)[dataViewBaseKey] ?? view;

export const getDataViewListOptions = <Item extends AnyRecord>(
  view: DataView<Item>,
): DataViewListOptions | undefined =>
  (view as DataView<Item> & DataViewInternals<Item>)[dataViewListOptionsKey];

/**
 * Declares a server data view that exposes an object's available fields to the client.
 *
 * @example
 * const Post = dataView<PostItem>('Post')({
 *   id: true,
 *   title: true,
 * });
 */
export function dataView<Item extends AnyRecord>(typeName: string) {
  return <Fields extends DataViewConfig<Item>>(fields: Fields) => {
    return {
      [dataViewFieldsKey]: fields,
      fields,
      typeName,
    } as DataView<Item> & {
      readonly [dataViewFieldsKey]: Fields;
    };
  };
}

export type ListViews = Record<string, DataView<AnyRecord>>;

export type ListEntry<Name extends string> = {
  __typename: Name;
  cursor: string;
  id: string;
};

type ListQueryOptions<Context> = {
  args?: AnyRecord;
  ctx: Context;
  cursor?: string;
  direction: 'backward' | 'forward';
  take: number;
};

type PolymorphicListOptions<Views extends ListViews, Context> = {
  query: (
    options: ListQueryOptions<Context>,
  ) => Promise<Array<ListEntry<Extract<keyof Views, string>>>>;
  typeName: string;
};

export type PolymorphicList<
  Views extends ListViews = ListViews,
  Context = any,
> = PolymorphicListOptions<Views, Context> & { kind: 'list'; views: Views };

/** Marks a data view as a list so the server can respond with connection information. */
export function list<V extends DataView<any>>(
  view: V,
  options?: DataViewListOptions,
): V & DataViewInternals<any> & { kind: 'list' };
/** Declares a root list whose page query can return entries from several data views. */
export function list<const Views extends ListViews, Context>(
  views: Views,
  options: PolymorphicListOptions<Views, Context>,
): PolymorphicList<Views, Context>;
export function list(
  view: DataView<any> | ListViews,
  options?: DataViewListOptions | PolymorphicListOptions<any, any>,
): (DataView<any> & DataViewInternals<any> & { kind: 'list' }) | PolymorphicList<any> {
  if (isDataView(view)) {
    return {
      ...view,
      [dataViewBaseKey]: getBaseDataView(view),
      ...(options && !('query' in options) ? { [dataViewListOptionsKey]: options } : null),
      kind: 'list' as const,
    };
  }

  const entries = Object.entries(view);
  if (
    !options ||
    !('query' in options) ||
    typeof options.query !== 'function' ||
    !options.typeName ||
    !entries.length ||
    Object.hasOwn(view, options.typeName)
  ) {
    throw new Error(
      'fate: A list of multiple types needs a type name, a page query, and data views.',
    );
  }
  for (const [type, member] of entries) {
    if (member.typeName !== type || member.fields.id !== true) {
      throw new Error(`fate: List type '${type}' needs a matching data view with id selected.`);
    }
  }

  return { kind: 'list' as const, query: options.query, typeName: options.typeName, views: view };
}

/**
 * Declares a resolver field inside a data view, optionally providing a
 * selection for any data dependencies.
 */
export function resolver<Item extends AnyRecord, Result = unknown, Context = unknown>(config: {
  authorize?: ResolverAuthorize<Item, Context>;
  resolve: ResolverResolve<Item, Result, Context>;
  select?: ResolverSelect<Context>;
}): ResolverField<Item, Result, Context> {
  return {
    kind: 'resolver' as const,
    ...config,
  };
}

export const field = <Path extends string>(
  path: Path,
  options?: MemoFieldOptions,
): FieldSelection<Path> => ({
  ...options,
  kind: 'field',
  path,
});

export const count = (relation: string, options?: { where?: CountWhere }): CountSelection => ({
  kind: 'count',
  relation,
  where: options?.where,
});

/**
 * Defines a field from selected dependencies. Client views share its result until
 * a dependency changes; server data views resolve it from the selected source data.
 */
export function memo<
  Item extends AnyRecord,
  Result = unknown,
  Context = unknown,
  const Select extends MemoSelectInput | undefined = MemoSelectInput,
>(config: {
  authorize?: ResolverAuthorize<Item, Context>;
  resolve: MemoResolve<Item, Result, NormalizeMemoSelect<Select>, Context>;
  select?: Select;
}): MemoField<Item, Result, Context, NormalizeMemoSelect<Select>> {
  const { select, ...definition } = config;
  return {
    kind: 'computed' as const,
    ...definition,
    ...(select && {
      select: Object.fromEntries(
        Object.entries(select).map(([name, selection]) => [
          name,
          selection === true
            ? field(name)
            : 'kind' in selection
              ? selection
              : field(name, selection),
        ]),
      ) as NormalizeMemoSelect<Select>,
    }),
  };
}

/**
 * @deprecated Use `memo` instead.
 * @hidden
 */
export const computed = memo;

type NonNullish<T> = Exclude<T, null | undefined>;

type WithNullish<Original, Value> = null extends Original
  ? undefined extends Original
    ? Value | null | undefined
    : Value | null
  : undefined extends Original
    ? Value | undefined
    : Value;

type ResolverResult<Field> =
  Field extends ResolverField<AnyRecord, any, any>
    ? Field['authorize'] extends ResolverAuthorize<any, any>
      ? Awaited<ReturnType<Field['resolve']>> | null
      : Awaited<ReturnType<Field['resolve']>>
    : never;

type MemoResult<Field> =
  Field extends MemoField<AnyRecord, any, any, any>
    ? Field['authorize'] extends ResolverAuthorize<any, any>
      ? Awaited<ReturnType<Field['resolve']>> | null
      : Awaited<ReturnType<Field['resolve']>>
    : never;

type RelationResult<ItemField, V extends DataView<AnyRecord>> =
  NonNullish<ItemField> extends Array<unknown>
    ? WithNullish<ItemField, Array<RawDataViewResult<V>>>
    : WithNullish<ItemField, RawDataViewResult<V>>;

export type ViewFieldConfig<V extends DataView<AnyRecord>> = V extends {
  readonly [dataViewFieldsKey]: infer Fields;
}
  ? Fields
  : V['fields'];

type RawFieldResult<
  Item extends AnyRecord,
  Key extends PropertyKey,
  Field extends DataField<Item>,
> = Field extends true
  ? Key extends keyof Item
    ? Item[Key]
    : never
  : Field extends DataView<any>
    ? Key extends keyof Item
      ? RelationResult<Item[Key], Field>
      : never
    : Field extends MemoField<Item, any, any, any>
      ? MemoResult<Field>
      : Field extends ResolverField<Item, any, any>
        ? ResolverResult<Field>
        : never;

/** @internal Resolved values before transport serialization. */
export type RawDataViewResult<V extends DataView<AnyRecord>> =
  V extends DataView<infer Item>
    ? {
        [K in keyof ViewFieldConfig<V>]: RawFieldResult<Item, K, ViewFieldConfig<V>[K]>;
      }
    : never;

export type DataViewResult<V extends DataView<AnyRecord>> = Serializable<RawDataViewResult<V>>;

type WithTypename<T, Name extends string> = T & { __typename: Name };

/**
 * Resolved entity type from a data view for client use.
 */
export type Entity<
  TView extends DataView<AnyRecord>,
  Name extends string,
  Replacements extends Record<string, unknown> = Record<never, never>,
> = WithTypename<Omit<DataViewResult<TView>, keyof Replacements> & Replacements, Name>;

/**
 * @deprecated Use `MemoField` instead.
 * @hidden
 */
export type ComputedField<
  Item extends AnyRecord,
  Result,
  Context,
  Select extends Record<string, MemoSelection> | undefined = Record<string, MemoSelection>,
> = MemoField<Item, Result, Context, Select>;

/**
 * @deprecated Use `MemoSelection` instead.
 * @hidden
 */
export type ComputedSelection = MemoSelection;
