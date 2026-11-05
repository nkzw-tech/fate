import type { DataView, PolymorphicList } from '../server/dataView.ts';

type AnyRecord = Record<string, unknown>;
type AnyDataView = DataView<any>;

type RelationDescriptor = { listOf: string } | { type: string };

type FateTypeConfig = {
  fields?: Record<string, RelationDescriptor>;
  possibleTypes?: ReadonlyArray<string>;
  type: string;
};

export const isDataView = (value: unknown): value is AnyDataView =>
  Boolean(value) &&
  typeof value === 'object' &&
  typeof (value as { typeName?: unknown }).typeName === 'string' &&
  Boolean((value as { fields?: unknown }).fields) &&
  typeof (value as { fields?: unknown }).fields === 'object';

type RootConfig =
  | DataView<AnyRecord>
  | PolymorphicList
  | {
      procedure?: string;
      router?: string;
      view: DataView<AnyRecord> | PolymorphicList;
    };

/**
 * Builds the schema object used by the Vite plugin from your data views and
 * root resolver configs.
 */
export const createSchema = (
  dataViews: ReadonlyArray<DataView<AnyRecord>>,
  roots: Record<string, RootConfig>,
) => {
  const rootSchema: Record<
    string,
    {
      kind: 'list' | 'query';
      procedure: string;
      router: string;
      type: string;
    }
  > = {};
  const fateTypes = new Map<string, FateTypeConfig>();
  const processing = new Set<string>();

  const ensureType = (view: DataView<AnyRecord>): string => {
    const typeName = view.typeName;

    const existing = fateTypes.get(typeName);

    if (processing.has(typeName)) {
      return typeName;
    }

    processing.add(typeName);

    const fields: FateTypeConfig['fields'] = existing?.fields ?? {};

    for (const [field, child] of Object.entries(view.fields)) {
      if (isDataView(child)) {
        const relationType = ensureType(child);
        fields[field] = child.kind === 'list' ? { listOf: relationType } : { type: relationType };
      }
    }

    const descriptor: FateTypeConfig = { type: typeName };
    if (Object.keys(fields).length) {
      descriptor.fields = fields;
    }

    fateTypes.set(typeName, descriptor);

    processing.delete(typeName);

    return typeName;
  };

  for (const view of dataViews) {
    const typeName = view.typeName;

    if (!typeName) {
      throw new Error('Data view is missing a type name.');
    }
  }

  for (const view of dataViews) {
    ensureType(view);
  }

  for (const [name, root] of Object.entries(roots)) {
    const config = 'view' in root ? root : { view: root };
    const view = config.view;

    if (!view.typeName) {
      throw new Error(`Root "${name}" is missing a data view.`);
    }

    const type = 'views' in view ? view.typeName : ensureType(view);
    if ('views' in view) {
      const possibleTypes = Object.values(view.views).map(ensureType);
      fateTypes.set(type, { possibleTypes, type });
    }
    const isList = view.kind === 'list';

    const router = config.router ?? view.typeName[0]?.toLowerCase() + view.typeName.slice(1);

    if (!router) {
      throw new Error(`Root "${name}" is missing a router name.`);
    }

    rootSchema[name] = {
      kind: isList ? 'list' : 'query',
      procedure: config.procedure ?? (isList ? 'list' : name),
      router,
      type,
    };
  }

  for (const view of dataViews) {
    ensureType(view);
  }

  return {
    roots: rootSchema,
    types: Array.from(fateTypes.values()),
  } as const;
};
