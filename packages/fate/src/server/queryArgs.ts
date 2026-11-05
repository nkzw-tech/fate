import { isRecord } from '../record.ts';
import type { AnyRecord } from '../types.ts';

export const toPrismaArgs = (args: AnyRecord): AnyRecord => {
  const prismaArgs: AnyRecord = {};

  const isBackward = args.before !== undefined || typeof args.last === 'number';

  const size = args.last ?? args.first;
  if (typeof size === 'number') {
    prismaArgs.take = (isBackward ? -1 : 1) * (size + 1);
  } else if (isBackward) {
    // Prisma requires a negative take to page backward. Use its maximum
    // integer limit when the caller did not supply a page size.
    prismaArgs.take = -(2 ** 31 - 1);
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
