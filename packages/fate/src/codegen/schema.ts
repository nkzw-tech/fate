import type { DataView } from '../server/dataView.ts';

type AnyRecord = Record<string, unknown>;

type RelationDescriptor = { listOf: string } | { type: string };

type FateTypeConfig = {
  fields?: Record<string, RelationDescriptor>;
  type: string;
};

const isDataViewField = (
  field: unknown,
): field is DataView<AnyRecord, unknown> =>
  Boolean(field) &&
  typeof field === 'object' &&
  'fields' in (field as AnyRecord);

type ListConfig =
  | DataView<AnyRecord, unknown>
  | {
      procedure?: string;
      view: DataView<AnyRecord, unknown>;
    };

/**
 * Builds the schema object used by the CLI generator from your data views and
 * list resolver configs.
 */
export const createFateSchema = (
  dataViews: ReadonlyArray<DataView<AnyRecord, unknown>>,
  lists: Record<string, ListConfig>,
) => {
  const canonicalViews = new Map<string, DataView<AnyRecord, unknown>>();
  const entities: Record<
    string,
    { list?: string; listProcedure?: string; type: string }
  > = {};
  const fateTypes = new Map<string, FateTypeConfig>();
  const processing = new Set<string>();

  const ensureType = (view: DataView<AnyRecord, unknown>): string => {
    const typeName = view.typeName;

    const canonicalView = canonicalViews.get(typeName) ?? view;
    const existing = fateTypes.get(typeName);

    if (existing && !processing.has(typeName)) {
      return typeName;
    }

    if (processing.has(typeName)) {
      return typeName;
    }

    processing.add(typeName);

    const fields: FateTypeConfig['fields'] = existing?.fields ?? {};

    for (const [field, child] of Object.entries(canonicalView.fields)) {
      if (isDataViewField(child)) {
        const relationType = ensureType(child);
        fields[field] =
          child.kind === 'list'
            ? { listOf: relationType }
            : { type: relationType };
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

    if (!canonicalViews.has(typeName)) {
      canonicalViews.set(typeName, view);
    }

    entities[typeName.toLowerCase()] = { type: typeName };
  }

  for (const [name, list] of Object.entries(lists)) {
    const config = 'fields' in list ? { view: list } : list;
    const typeName = ensureType(config.view);

    entities[typeName.toLowerCase()] = {
      list: name,
      listProcedure: config.procedure,
      type: typeName,
    };
  }

  return {
    entities,
    types: Array.from(fateTypes.values()),
  } as const;
};
