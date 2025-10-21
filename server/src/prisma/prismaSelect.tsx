export function prismaSelect(
  paths?: Array<string>,
): Record<string, unknown> | undefined {
  if (!paths || paths.length === 0) {
    return undefined;
  }
  const allPaths = Array.from(new Set([...paths, 'id']));
  const select: Record<string, unknown> = {};
  for (const path of allPaths) {
    const segs = path.split('.');
    let current = select;
    segs.forEach((seg, idx) => {
      if (idx === segs.length - 1) {
        current[seg] = true;
      } else {
        current[seg] = current[seg] ?? { select: {} };
        current = (current[seg] as { select: Record<string, unknown> }).select;
      }
    });
  }
  return select;
}
