import { schemaField } from './alias.ts';
import type { SelectionPlan } from './selection.ts';

export const argumentFieldKey = (field: string, hash?: string): string =>
  hash && hash !== 'object:{}'
    ? `${field}(${encodeURIComponent(hash).replaceAll('.', '%2E')})`
    : field;

export const getFieldKey = (path: string, plan?: SelectionPlan): string =>
  argumentFieldKey(schemaField(path.slice(path.lastIndexOf('.') + 1)), plan?.args.get(path)?.hash);

export const getStoragePath = (path: string, plan?: SelectionPlan, prefix = ''): string => {
  if (!path.includes('.')) {
    return getFieldKey(prefix ? `${prefix}.${path}` : path, plan);
  }
  let current = prefix;
  return path
    .split('.')
    .map((field) => {
      current = current ? `${current}.${field}` : field;
      return getFieldKey(current, plan);
    })
    .join('.');
};
