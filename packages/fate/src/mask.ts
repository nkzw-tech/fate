export type FieldMask = {
  all: boolean;
  children: Map<string, FieldMask>;
};

export function emptyMask(): FieldMask {
  return { all: false, children: new Map() };
}

export function cloneMask(m: FieldMask): FieldMask {
  const clone = { all: m.all, children: new Map<string, FieldMask>() };
  for (const [key, value] of m.children) {
    clone.children.set(key, cloneMask(value));
  }
  return clone;
}

export function addPath(mask: FieldMask, path: string) {
  if (mask.all) {
    return;
  }

  const parts = path.split('.');
  let current = mask;
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    let child = current.children.get(seg);
    if (!child) {
      child = emptyMask();
      current.children.set(seg, child);
    }
    current = child;
  }

  current.all = true;
  current.children.clear();
}

export function union(into: FieldMask, b: FieldMask) {
  if (into.all || b.all) {
    into.all = true;
    into.children.clear();
    return;
  }

  for (const [key, child] of b.children) {
    const exist = into.children.get(key);
    if (!exist) {
      into.children.set(key, cloneMask(child));
    } else {
      union(exist, child);
    }
  }
}

export function fromPaths(paths: Iterable<string>): FieldMask {
  const mask = emptyMask();
  for (const path of paths) {
    addPath(mask, path);
  }
  return mask;
}

export function isCovered(mask: FieldMask, path: string): boolean {
  if (mask.all) {
    return true;
  }

  const parts = path.split('.');
  let current: FieldMask | undefined = mask;
  for (let i = 0; i < parts.length; i++) {
    if (!current) {
      return false;
    }

    if (current.all) {
      return true;
    }

    current = current.children.get(parts[i]);
  }

  return !!current && (current.all || current.children.size === 0);
}

export function diffPaths(
  paths: Iterable<string>,
  mask: FieldMask,
): Set<string> {
  const missing = new Set<string>();
  for (const path of paths) {
    if (!isCovered(mask, path)) {
      missing.add(path);
    }
  }
  return missing;
}

export function intersects(a: FieldMask, b: FieldMask): boolean {
  if (a.all || b.all) {
    return true;
  }

  for (const [key, child] of a.children) {
    const otherChild = b.children.get(key);
    if (!otherChild) {
      continue;
    }

    if (child.all || otherChild.all) {
      return true;
    }

    if (intersects(child, otherChild)) {
      return true;
    }
  }

  return false;
}
