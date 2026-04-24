import { isRecord } from '../record.ts';
import type { AnyRecord } from '../types.ts';

export const toPrismaArgs = (args: AnyRecord): AnyRecord => {
  const prismaArgs: AnyRecord = {};

  const isBackward = args.before !== undefined || typeof args.last === 'number';

  if (typeof args.first === 'number') {
    prismaArgs.take = args.first + 1;
  }

  if (typeof args.last === 'number') {
    prismaArgs.take = -(args.last + 1);
  }

  const cursor = isBackward ? args.before : args.after;

  if (cursor !== undefined) {
    prismaArgs.cursor = { id: cursor };
    prismaArgs.skip = 1;
  }

  return prismaArgs;
};

/**
 * Narrows nested args to the slice relevant for a particular selection path.
 */
export function getScopedArgs(args: AnyRecord | undefined, path: string): AnyRecord | undefined {
  if (!args) {
    return undefined;
  }

  const segments = path.split('.');
  let current: unknown = args;

  for (const segment of segments) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return isRecord(current) ? current : undefined;
}
