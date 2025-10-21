import type { Entity, Fragment, Selection } from './types.ts';

export function fragment<T extends Entity>() {
  return <S extends Selection<T>>(select: S): Fragment<T, S> => ({
    select,
  });
}
