export type GraphQLErrorPayload = Readonly<{
  extensions?: Record<string, unknown>;
  message?: string;
  path?: ReadonlyArray<number | string>;
}>;

/** A failed GraphQL operation. Partial data is diagnostic and is never normalized. */
export class GraphQLRequestError extends Error {
  override readonly name = 'GraphQLRequestError';
  readonly errors: ReadonlyArray<GraphQLErrorPayload>;
  readonly kind: 'execution' | 'protocol';
  readonly status?: number;
  readonly data?: unknown;

  constructor(
    errors: ReadonlyArray<GraphQLErrorPayload>,
    options: {
      data?: unknown;
      kind?: 'execution' | 'protocol';
      message?: string;
      status?: number;
    } = {},
  ) {
    super(errors[0]?.message ?? options.message ?? 'GraphQL request failed.');
    this.errors = Object.freeze([...errors]);
    this.kind = options.kind ?? 'execution';
    this.status = options.status;
    this.data = options.data;
  }

  get extensions() {
    return this.errors[0]?.extensions;
  }

  get path() {
    return this.errors[0]?.path;
  }
}
