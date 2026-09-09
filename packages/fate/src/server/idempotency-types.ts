import type { MutationIdentity } from '../persistence-types.ts';

/** Server enforcement for a durable mutation. The resolver must use the supplied context. */
export interface MutationIdempotency<Context> {
  execute<Result>(options: MutationIdempotencyOptions<Context, Result>): Promise<Result>;
}

export type MutationIdempotencyOptions<Context, Result> = Readonly<{
  ctx: Context;
  identity: MutationIdentity;
  input: unknown;
  name: string;
  resolve(ctx: Context): Promise<Result>;
  select: ReadonlyArray<string>;
}>;
