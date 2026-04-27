import type { Pagination } from './types.ts';

export type FateProtocolVersion = 1;

export type FateOperationKind = 'byId' | 'list' | 'mutation' | 'query';

export type FateOperation = Readonly<{
  args?: Record<string, unknown>;
  id: string;
  ids?: Array<string | number>;
  input?: unknown;
  kind: FateOperationKind;
  name?: string;
  select: Array<string>;
  type?: string;
}>;

export type FateOperationResult =
  | Readonly<{
      data: unknown;
      id: string;
      ok: true;
    }>
  | Readonly<{
      error: FateProtocolError;
      id: string;
      ok: false;
    }>;

export type FateProtocolRequest = Readonly<{
  operations: Array<FateOperation>;
  version: FateProtocolVersion;
}>;

export type FateProtocolResponse = Readonly<{
  results: Array<FateOperationResult>;
  version: FateProtocolVersion;
}>;

export type FateLiveRequest = Readonly<{
  args?: Record<string, unknown>;
  id: string | number;
  lastEventId?: string;
  select: Array<string>;
  type: string;
  version: FateProtocolVersion;
}>;

export type FateLiveDataEvent = Readonly<{
  data: unknown;
  delete?: false;
  type?: 'data' | 'update';
}>;

export type FateLiveDeleteEvent = Readonly<{
  delete: true;
  id?: string | number;
  type?: 'delete';
}>;

export type FateLiveEvent = FateLiveDataEvent | FateLiveDeleteEvent;

export type FateConnectionResult = Readonly<{
  items: Array<{ cursor?: string; node: unknown }>;
  pagination: Pagination;
}>;

export type FateProtocolErrorCode =
  | 'BAD_REQUEST'
  | 'FORBIDDEN'
  | 'INTERNAL_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR';

export type FateProtocolError = Readonly<{
  code: FateProtocolErrorCode;
  issues?: unknown;
  message: string;
  path?: string;
}>;

export class FateRequestError extends Error {
  readonly code: FateProtocolErrorCode;
  readonly issues?: unknown;
  readonly status: number;

  constructor(
    code: FateProtocolErrorCode,
    message: string,
    options: { issues?: unknown; status?: number } = {},
  ) {
    super(message);
    this.name = 'FateRequestError';
    this.code = code;
    this.issues = options.issues;
    this.status = options.status ?? statusFromErrorCode(code);
  }
}

export const statusFromErrorCode = (code: FateProtocolErrorCode): number => {
  switch (code) {
    case 'BAD_REQUEST':
    case 'VALIDATION_ERROR':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'INTERNAL_ERROR':
      return 500;
  }
};

export const errorCodeFromStatus = (status: number): FateProtocolErrorCode => {
  if (status === 400) {
    return 'BAD_REQUEST';
  }
  if (status === 401) {
    return 'UNAUTHORIZED';
  }
  if (status === 403) {
    return 'FORBIDDEN';
  }
  if (status === 404) {
    return 'NOT_FOUND';
  }
  return 'INTERNAL_ERROR';
};

export const toProtocolError = (error: unknown): FateProtocolError => {
  if (error instanceof FateRequestError) {
    return {
      code: error.code,
      issues: error.issues,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error.',
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'Internal server error.',
  };
};
