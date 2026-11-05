import type { View, ViewEntityName } from './types.ts';
import { isViewTag } from './types.ts';

const TypeBranch = Symbol('fate.type-branch');
export const typeBranchPrefix = '__fate-on-type__';
export type TypeBranchKey = `${typeof typeBranchPrefix}${string}`;

export type TypeBranchSelection<Type extends string = string> = Readonly<{
  type: Type;
  [TypeBranch]: true;
  view: View<any, any>;
}>;

export const isTypeBranch = (value: unknown): value is TypeBranchSelection =>
  Boolean(value && typeof value === 'object' && TypeBranch in value);

/** Compose a view when a GraphQL result has the given concrete typename. */
export function forType<V extends View<any, any>, const Type extends ViewEntityName<V>>(
  type: Type,
  view: V & (ViewEntityName<V> extends NoInfer<Type> ? unknown : never),
): Readonly<Record<TypeBranchKey, TypeBranchSelection<Type>>> {
  if (!/^[_A-Za-z][_0-9A-Za-z]*$/.test(type)) {
    throw new Error(`fate: Invalid typename '${type}'.`);
  }
  const names = Object.keys(view).filter(isViewTag);
  if (typeof view === 'function' || !names.length) {
    throw new Error('fate: forType requires a view with its parameters bound.');
  }
  return {
    [`${typeBranchPrefix}${type}:${names.join(',')}`]: Object.freeze({
      type,
      [TypeBranch]: true as const,
      view,
    }),
  };
}
