import type { DataView } from '../server/dataView.ts';

type AnyRecord = Record<string, unknown>;

type RelationDescriptor = { listOf: string } | { type: string };

type FateTypeConfig = {
  fields?: Record<string, RelationDescriptor>;
  type: string;
};

const isDataViewField = (field: unknown): field is DataView<AnyRecord> =>
  Boolean(field) && typeof field === 'object' && 'fields' in (field as AnyRecord);

type RootConfig =
  | DataView<AnyRecord>
  | {
      procedure?: string;
      router?: string;
      view: DataView<AnyRecord>;
    };

/**
 * Builds the schema object used by the CLI generator from your data views and
 * root resolver configs.
 */
export const createSchema = (
  dataViews: ReadonlyArray<DataView<AnyRecord>>,
  roots: Record<string, RootConfig>,
) => {
  const canonicalViews = new Map<string, DataView<AnyRecord>>();
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

    if (!canonicalViews.has(typeName)) {
      canonicalViews.set(typeName, view);
    }
  }

  for (const view of dataViews) {
    ensureType(view);
  }

  for (const [name, root] of Object.entries(roots)) {
    const config = 'fields' in root ? { view: root } : root;
    const view = config.view;
    const type = ensureType(view);

    if (!view.typeName) {
      throw new Error(`Root "${name}" is missing a data view.`);
    }

    const router = config.router ?? view.typeName[0]?.toLowerCase() + view.typeName.slice(1);

    if (!router) {
      throw new Error(`Root "${name}" is missing a router name.`);
    }

    rootSchema[name] = {
      kind: view.kind === 'list' ? 'list' : 'query',
      procedure: config.procedure ?? (view.kind === 'list' ? 'list' : name),
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
