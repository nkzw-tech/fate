import { AnyRecord } from './types.ts';

export const isRecord = (value: unknown): value is AnyRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
