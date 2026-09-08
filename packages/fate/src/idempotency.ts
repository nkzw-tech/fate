import { decodeHydrationValue, encodeHydrationValue } from './hydration.ts';
import { FateRequestError } from './protocol.ts';
import type { MutationIdempotency } from './server/idempotency-types.ts';
import { sortObjectKeys } from './sortObjectKeys.ts';

export type { MutationIdempotency } from './server/idempotency-types.ts';

export type MutationReceipt = Readonly<{
  fingerprint: string;
  result: ReturnType<typeof encodeHydrationValue>;
}>;

/**
 * All methods and the resolver run in ONE application database transaction.
 * The adapter must serialize concurrent calls for the same scope and ID,
 * including calls from different processes. Receipts must not expire.
 */
export interface IdempotencyStore<Context> {
  transaction<T>(
    context: Context,
    scope: string,
    id: string,
    run: (transaction: {
      context: Context;
      read(): Promise<MutationReceipt | undefined>;
      write(receipt: MutationReceipt): Promise<void>;
    }) => Promise<T>,
  ): Promise<T>;
}

/** Enforces durable deduplication using the application's own transaction adapter. */
export function createMutationIdempotency<Context>(options: {
  scope(context: Context): string | Promise<string>;
  store: IdempotencyStore<Context>;
}): MutationIdempotency<Context> {
  return {
    async execute<Result>({
      ctx,
      identity,
      input,
      name,
      resolve,
      select,
    }: {
      ctx: Context;
      identity: import('./persistence-types.ts').MutationIdentity;
      input: unknown;
      name: string;
      resolve(ctx: Context): Promise<Result>;
      select: Array<string>;
    }): Promise<Result> {
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
      const fingerprint = JSON.stringify(
        encodeHydrationValue(sortObjectKeys({ input, name, select: [...select].sort() })),
      );
      return options.store.transaction(ctx, scope, identity.id, async (transaction) => {
        const receipt = await transaction.read();
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
        await transaction.write({ fingerprint, result: encoded });
        return result;
      });
    },
  };
}
