export type IndexedValues = string | Set<string>;
export type ReferenceIndex = Map<string, IndexedValues>;

export const appendIndexValue = (
  values: IndexedValues | undefined,
  value: string,
): IndexedValues => {
  if (values === undefined) {
    return value;
  }
  if (typeof values === 'string') {
    return values === value ? values : new Set([values, value]);
  }
  values.add(value);
  return values;
};

export const addIndexValue = (index: ReferenceIndex, key: string, value: string) => {
  const previous = index.get(key);
  const next = appendIndexValue(previous, value);
  if (next !== previous) {
    index.set(key, next);
  }
};

export const removeIndexValue = (index: ReferenceIndex, key: string, value: string) => {
  const values = index.get(key);
  if (typeof values === 'string') {
    if (values === value) {
      index.delete(key);
    }
  } else if (values) {
    values.delete(value);
    if (values.size === 0) {
      index.delete(key);
    } else if (values.size === 1) {
      index.set(key, values.values().next().value!);
    }
  }
};

export const indexValues = (values: IndexedValues | undefined): Iterable<string> =>
  typeof values === 'string' ? [values] : (values ?? []);

export const copyIndexValues = (values: IndexedValues | undefined): Array<string> =>
  typeof values === 'string' ? [values] : values ? [...values] : [];
