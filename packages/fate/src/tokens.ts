import type { EntityId, FragmentRef, TypeName } from './types.ts';

export const toEntityId = (type: TypeName, rawId: string | number): EntityId =>
  `${type}:${String(rawId)}`;

export function parseEntityId(id: EntityId) {
  const idx = id.indexOf(':');
  return idx < 0
    ? { raw: id, type: '' }
    : ({ raw: id.slice(idx + 1), type: id.slice(0, idx) } as const);
}

export function createTokenRegistry() {
  const idToToken = new Map<EntityId, FragmentRef<string>>();
  const tokenToId = new WeakMap<FragmentRef<string>, EntityId>();

  const idOf = <TName extends string>(ref: FragmentRef<TName>): EntityId => {
    const id = tokenToId.get(ref);
    if (!id) {
      throw new Error(`fate: Empty Ref passed to 'idOf()'`);
    }
    return id;
  };

  return {
    idOf,

    refFor: <TName extends string>(
      type: TName,
      rawId: string | number,
    ): FragmentRef<TName> => {
      const id = toEntityId(type, rawId);
      let ref = idToToken.get(id) as FragmentRef<TName> | undefined;
      if (!ref) {
        ref = { __typename: type, id } as FragmentRef<TName>;

        idToToken.set(id, ref as FragmentRef<string>);
        tokenToId.set(ref, id);
      }
      return ref;
    },

    typeOf: <TName extends string>(ref: FragmentRef<TName>): TName =>
      parseEntityId(idOf(ref)).type as TName,
  };
}
