import { readAliases } from '../alias-transport.ts';
import { schemaField, typeCondition } from '../alias.ts';
import { FateRequestError } from '../protocol.ts';
import type { AnyRecord } from '../types.ts';
import { resolveConnection, type ConnectionResult } from './connection.ts';
import type {
  DataView,
  DataViewResult,
  ListEntry,
  ListViews,
  PolymorphicList,
} from './dataView.ts';
import { resolveSourceByIds, type SourceRegistry } from './executor.ts';
import type { SourceDefinition } from './source.ts';

type ViewName<Views extends ListViews> = Extract<keyof Views, string>;

export type PolymorphicListResult<Views extends ListViews> = ConnectionResult<
  {
    [Name in ViewName<Views>]: DataViewResult<Views[Name]> & {
      __typename: Name;
      id: string | number;
    };
  }[ViewName<Views>]
>;

/** Resolves one page of identities using the registered source for each concrete type. */
export async function resolvePolymorphicList<Context, const Views extends ListViews>({
  ctx,
  input,
  list,
  sources,
}: {
  ctx: Context;
  input: { args?: AnyRecord; select: Array<string> };
  list: PolymorphicList<Views, Context>;
  sources: {
    getSource: (view: DataView<AnyRecord>) => SourceDefinition<AnyRecord>;
    registry: SourceRegistry<Context>;
  };
}): Promise<PolymorphicListResult<Views>> {
  const shared = new Set<string>();
  const branches = new Map<string, Set<string>>();
  for (const path of input.select) {
    const [field, ...nested] = path.split('.');
    const type = typeCondition(field);
    if (nested.some(typeCondition) || (type && !Object.hasOwn(list.views, type))) {
      throw new FateRequestError('VALIDATION_ERROR', `Invalid list type selection '${path}'.`);
    }
    // Identity is always included. Keeping its canonical key also lets us join rows to cursors.
    if (!nested.length && (schemaField(field) === 'id' || schemaField(field) === '__typename')) {
      continue;
    }
    if (!type) {
      shared.add(path);
      continue;
    }
    let selected = branches.get(type);
    if (!selected) {
      selected = new Set();
      branches.set(type, selected);
    }
    selected.add(path);
  }

  const page = await resolveConnection({
    ctx,
    getCursor: (entry: ListEntry<ViewName<Views>>) => entry.cursor,
    input,
    query: ({ cursor, direction, take }) =>
      list.query({ args: input.args, ctx, cursor, direction, take }),
  });
  const idsByType = new Map<string, Set<string>>();
  for (const { node } of page.items) {
    const { __typename: type, id } = node;
    if (!Object.hasOwn(list.views, type)) {
      throw new Error(`fate: Unregistered member '${type}' returned by '${list.typeName}'.`);
    }
    let ids = idsByType.get(type);
    if (!ids) {
      ids = new Set();
      idsByType.set(type, ids);
    }
    ids.add(id);
  }

  const rowsByType = new Map(
    await Promise.all(
      [...idsByType].map(async ([type, ids]) => {
        const source = sources.getSource(list.views[type]);
        const select = new Set([...shared, ...(branches.get(type) ?? [])]);
        const rows = (await readAliases(
          select,
          input.args,
          (select, args) =>
            resolveSourceByIds({
              ctx,
              ids: [...ids],
              input: { args, select },
              registry: sources.registry,
              source,
            }),
          true,
        )) as Array<AnyRecord>;
        return [type, new Map(rows.map((row) => [String(row.id), row]))] as const;
      }),
    ),
  );

  // Keep the page's cursors even if a source row disappears after membership was queried.
  return {
    items: page.items.flatMap(({ cursor, node: { __typename, id } }) => {
      const row = rowsByType.get(__typename)?.get(id);
      return row ? [{ cursor, node: { ...row, __typename } }] : [];
    }),
    pagination: page.pagination,
  } as PolymorphicListResult<Views>;
}
