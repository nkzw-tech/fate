import { isViewTag, type View } from './types.ts';

const AliasTag = Symbol('fate.alias');
const FragmentAliasTag = Symbol('fate.fragment-alias');

export type AliasedView<V extends View<any, any> = View<any, any>> = Readonly<{
  [FragmentAliasTag]: true;
  view: V;
}>;

export const isAliasedView = (value: unknown): value is AliasedView =>
  Boolean(value && typeof value === 'object' && FragmentAliasTag in value);

export type AliasedSelection<Field extends string = string, S = unknown> = Readonly<{
  [AliasTag]: true;
  field: Field;
  selection: S;
}>;

/** Select a same-entity view under a named ref. */
export function alias<V extends View<any, any>>(view: V): AliasedView<V>;
/** Select a schema field under a different result name, with its own arguments. */
export function alias<const Field extends string, const S>(
  field: Field,
  selection: S,
): AliasedSelection<Field, S>;
export function alias(field: string | View<any, any>, selection?: unknown) {
  if (typeof field !== 'string') {
    if (typeof field !== 'object' || !field || !Object.keys(field).some(isViewTag)) {
      throw new Error('fate: A named fragment requires a view with its parameters bound.');
    }
    return Object.freeze({ [FragmentAliasTag]: true, view: field });
  }
  if (!/^[_A-Za-z][_0-9A-Za-z]*$/.test(field)) {
    throw new Error(`fate: Invalid alias source field '${field}'.`);
  }
  return Object.freeze({ [AliasTag]: true, field, selection });
}

export const isAliasedSelection = (value: unknown): value is AliasedSelection =>
  Boolean(value && typeof value === 'object' && AliasTag in value);

/** Transport paths encode aliases as resultName:schemaField[:typeCondition]. */
export const schemaField = (field: string): string => {
  const start = field.indexOf(':') + 1;
  if (!start) {
    return field;
  }
  const end = field.indexOf(':', start);
  return end < 0 ? field.slice(start) : field.slice(start, end);
};

export const typeCondition = (field: string): string | undefined => {
  const alias = field.indexOf(':');
  const separator = alias < 0 ? -1 : field.indexOf(':', alias + 1);
  return separator < 0 ? undefined : field.slice(separator + 1);
};

export const pathHasTypeCondition = (path: string): boolean => {
  const alias = path.indexOf(':');
  if (alias < 0) {
    return false;
  }
  return path.split('.').some(typeCondition);
};

export const fieldAppliesTo = (field: string, type: string): boolean => {
  const condition = typeCondition(field);
  return condition === undefined || condition === type;
};

export const typeBranchField = (type: string, field: string): string =>
  `fate_type_${type.length}_${type}_${responseField(field)}:${schemaField(field)}:${type}`;
export const responseField = (field: string): string => field.split(':')[0];
export const aliasedField = (name: string, field: string): string => {
  if (
    !/^[_A-Za-z][_0-9A-Za-z]*$/.test(name) ||
    name === 'id' ||
    name === '__typename' ||
    name === '__proto__'
  ) {
    throw new Error(`fate: Invalid or reserved alias result name '${name}'.`);
  }
  return `${name}:${field}`;
};
