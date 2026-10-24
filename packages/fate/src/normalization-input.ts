import type { AnyRecord } from './types.ts';

export type NormalizationInput = {
  child(record: AnyRecord, key: string): NormalizationInput;
  connection(value: unknown): unknown;
  get(record: AnyRecord, key: string): unknown;
  has(record: AnyRecord, key: string): boolean;
  keys(record: AnyRecord): Array<string>;
  materialize(value: unknown): unknown;
};

const inputs = new WeakMap<object, NormalizationInput>();

export const normalizationInput = (value: object): NormalizationInput | undefined =>
  inputs.get(value);

export const withNormalizationInput = <T>(value: T, input: NormalizationInput): T => {
  if (value && typeof value === 'object') {
    inputs.set(value, input);
  }
  return value;
};
