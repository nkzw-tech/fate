import { decodeHydrationValue, encodeHydrationValue } from './hydration.ts';
import {
  defaultMutationMaxAge,
  expiredMutation,
  mutationClockSkew,
  readMutationLifetime,
  validateMutationMaxAge,
} from './mutation-identity.ts';
import { FateRequestError } from './protocol.ts';
import type {
  MutationIdempotency,
  MutationIdempotencyOptions,
} from './server/idempotency-types.ts';
import { sortObjectKeys } from './sortObjectKeys.ts';

export type {
  MutationIdempotency,
  MutationIdempotencyOptions,
} from './server/idempotency-types.ts';

export type MutationReceipt = Readonly<{
  expiresAt?: number;
  fingerprint: string;
  result: ReturnType<typeof encodeHydrationValue>;
}>;

/**
 * All methods and the resolver run in ONE application database transaction.
 * The adapter must serialize concurrent calls for the same scope and ID,
 * including calls from different processes. Bounded receipts may be deleted after
 * expiresAt plus a clock-skew margin. Legacy receipts must remain while legacy
 * identities are accepted.
 */
export interface IdempotencyStore<Context, TransactionContext extends Context = Context> {
  transaction<T>(
    context: Context,
    scope: string,
    id: string,
    run: (transaction: {
      context: TransactionContext;
      read(): Promise<MutationReceipt | undefined>;
      write(receipt: MutationReceipt): Promise<void>;
    }) => Promise<T>,
  ): Promise<T>;
}

/** Enforces durable deduplication using the application's own transaction adapter. */
export function createMutationIdempotency<
  Context,
  TransactionContext extends Context = Context,
>(options: {
  allowLegacyIdentities?: boolean;
  maxAge?: number;
  scope(context: Context): string | Promise<string>;
  store: IdempotencyStore<Context, TransactionContext>;
}): MutationIdempotency<Context> {
  const maxAge = options.maxAge ?? defaultMutationMaxAge;
  validateMutationMaxAge(maxAge);
  return {
    async execute<Result>({
      ctx,
      identity,
      input,
      name,
      resolve,
      select,
    }: MutationIdempotencyOptions<Context, Result>): Promise<Result> {
      const scope = await options.scope(ctx);
      if (!scope || scope !== identity.scope) {
        throw new FateRequestError(
          'FORBIDDEN',
          'Mutation identity does not match the authenticated persistence scope.',
        );
      }
      if (
        !identity.id ||
        identity.id.length > 256 ||
        (identity.replayOnly !== undefined && identity.replayOnly !== true)
      ) {
        throw new FateRequestError('BAD_REQUEST', 'Invalid mutation identity.');
      }
      const lifetime = readMutationLifetime(identity.id);
      if (!lifetime && options.allowLegacyIdentities === false) {
        throw expiredMutation();
      }
      const validateLifetime = () => {
        if (!lifetime) {
          return;
        }
        if (lifetime.expiresAt <= Date.now()) {
          throw expiredMutation();
        }
        if (
          lifetime.createdAt > Date.now() + mutationClockSkew ||
          lifetime.expiresAt - lifetime.createdAt > maxAge
        ) {
          throw new FateRequestError(
            'BAD_REQUEST',
            'Mutation lifetime exceeds the server policy or the client clock is ahead.',
          );
        }
      };
      validateLifetime();
      const fingerprint = JSON.stringify(
        encodeHydrationValue(sortObjectKeys({ input, name, select: [...select].sort() })),
      );
      return options.store.transaction(ctx, scope, identity.id, async (transaction) => {
        validateLifetime();
        const receipt = await transaction.read();
        validateLifetime();
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) {
            throw new FateRequestError(
              'BAD_REQUEST',
              'Mutation identity was reused with different input.',
            );
          }
          return decodeHydrationValue(receipt.result) as Result;
        }
        if (identity.replayOnly) {
          throw new FateRequestError('NOT_FOUND', 'Mutation receipt was not found.');
        }
        const result = await resolve(transaction.context);
        const encoded = encodeHydrationValue(result);
        await transaction.write({
          ...(lifetime && { expiresAt: lifetime.expiresAt }),
          fingerprint,
          result: encoded,
        });
        return result;
      });
    },
  };
}
