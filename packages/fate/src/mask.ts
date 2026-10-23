export type FieldMask = {
  all: boolean;
  children: ReadonlyMap<string, FieldMask>;
};

const emptyChildren: ReadonlyMap<string, FieldMask> = new Map();

const writableChildren = (mask: FieldMask): Map<string, FieldMask> => {
  if (mask.children === emptyChildren) {
    mask.children = new Map();
  }
  return mask.children as Map<string, FieldMask>;
};

export function emptyMask(): FieldMask {
  return { all: false, children: emptyChildren };
}

export function cloneMask(m: FieldMask): FieldMask {
  const clone = { all: m.all, children: emptyChildren };
  for (const [key, value] of m.children) {
    writableChildren(clone).set(key, cloneMask(value));
  }
  return clone;
}

export function addPath(mask: FieldMask, path: string) {
  if (mask.all) {
    return false;
  }

  let current = mask;
  let start = 0;
  while (true) {
    if (current.all) {
      return false;
    }
    const separator = path.indexOf('.', start);
    const seg = separator === -1 ? path.slice(start) : path.slice(start, separator);
    let child = current.children.get(seg);
    if (!child) {
      child = emptyMask();
      writableChildren(current).set(seg, child);
    }
    current = child;
    if (separator === -1) {
      break;
    }
    start = separator + 1;
  }

  if (current.all) {
    return false;
  }
  current.all = true;
  current.children = emptyChildren;
  return true;
}

export function union(into: FieldMask, b: FieldMask) {
  if (into.all || b.all) {
    into.all = true;
    into.children = emptyChildren;
    return;
  }

  for (const [key, child] of b.children) {
    const exist = into.children.get(key);
    if (!exist) {
      writableChildren(into).set(key, cloneMask(child));
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

export function toPaths(mask: FieldMask): Array<string> {
  const paths: Array<string> = [];

  const visit = (current: FieldMask, prefix: string | null) => {
    if (current.all) {
      if (prefix) {
        paths.push(prefix);
      }
      return;
    }

    for (const [key, child] of current.children) {
      visit(child, prefix ? `${prefix}.${key}` : key);
    }
  };

  visit(mask, null);
  return paths;
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

export function diffPaths(paths: Iterable<string>, mask: FieldMask): Set<string> {
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

/** Removes coverage below a replaced value before applying its new selection. */
export function removePath(mask: FieldMask, path: string) {
  const parts = path.split('.');
  const remove = (current: FieldMask, index: number) => {
    if (current.all) {
      current.all = false;
      current.children = emptyChildren;
      return;
    }
    const key = parts[index];
    const child = current.children.get(key);
    if (!child) {
      return;
    }
    if (index === parts.length - 1) {
      writableChildren(current).delete(key);
    } else {
      remove(child, index + 1);
      if (!child.all && child.children.size === 0) {
        writableChildren(current).delete(key);
      }
    }
  };
  remove(mask, 0);
}
