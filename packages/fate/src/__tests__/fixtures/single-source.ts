import type { DataView } from '../../data-view.ts';
import type { SourceDefinition } from '../../server/source.ts';
import type { AnyRecord } from '../../types.ts';

export function singleSource(source: SourceDefinition) {
  return <Item extends AnyRecord>(
    target: DataView<Item> | SourceDefinition<Item>,
  ): SourceDefinition<Item> => {
    if ('view' in target) {
      return target;
    }
    const matches = (candidate: SourceDefinition): candidate is SourceDefinition<Item> =>
      candidate.view.typeName === target.typeName;
    if (matches(source)) {
      return source;
    }
    throw new Error('Unknown source: ' + target.typeName);
  };
}
