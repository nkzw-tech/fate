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
    value = (Array.isArray(value) ? [...value] : { ...value }) as T;
    inputs.set(value as object, input);
  }
  return value;
};

const transports = new WeakSet<object>();
const contexts = new WeakSet<object>();

export const registerNormalizationTransport = <T extends object>(transport: T): T => {
  transports.add(transport);
  return transport;
};

export const normalizationReadContext = <T extends object>(
  transport: object,
  context?: T,
): T | undefined => {
  if (!transports.has(transport)) {
    return context;
  }
  const result = { ...context } as T;
  contexts.add(result);
  return result;
};

export const isNormalizationRead = (context: object | undefined): boolean =>
  context !== undefined && contexts.has(context);
