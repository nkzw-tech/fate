import { FateRequestError } from './protocol.ts';

export const defaultMutationMaxAge = 30 * 24 * 60 * 60 * 1000;
export const mutationClockSkew = 5 * 60 * 1000;

export const validateMutationMaxAge = (value: number) => {
  if (!Number.isSafeInteger(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER - Date.now()) {
    throw new Error('fate: Mutation maxAge must be a positive safe duration.');
  }
};

export const createMutationId = (maxAge: number) => {
  const createdAt = Date.now();
  return `fate:1:${createdAt}:${createdAt + maxAge}:${crypto.randomUUID()}`;
};

export const readMutationLifetime = (id: string) => {
  if (!id.startsWith('fate:')) {
    return undefined;
  }
  const match =
    /^fate:1:([1-9]\d*):([1-9]\d*):([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(
      id,
    );
  const createdAt = Number(match?.[1]);
  const expiresAt = Number(match?.[2]);
  if (
    !match ||
    !Number.isSafeInteger(createdAt) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= createdAt
  ) {
    throw new FateRequestError('BAD_REQUEST', 'Invalid expiring mutation identity.');
  }
  return { createdAt, expiresAt };
};

export const expiredMutation = () =>
  new FateRequestError(
    'MUTATION_EXPIRED',
    'The mutation expired. Its remote outcome is unknown; reconcile current server state before submitting a new operation.',
  );
