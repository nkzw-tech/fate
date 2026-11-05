import type { AnyRecord } from './types.ts';

export const isRecord = (value: unknown): value is AnyRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isDate = (value: unknown): value is Date =>
  value != null &&
  typeof value === 'object' &&
  Object.prototype.toString.call(value) === '[object Date]' &&
  typeof (value as Date).getTime === 'function';

export const setRecordValue = (record: AnyRecord, key: string, value: unknown): void => {
  if (key === '__proto__') {
    Object.defineProperty(record, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  } else {
    record[key] = value;
  }
};
