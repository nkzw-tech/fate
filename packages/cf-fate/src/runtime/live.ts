/* eslint-disable @nkzw/no-instanceof, perfectionist/sort-object-types, perfectionist/sort-objects */
type MaybePromise<T> = T | Promise<T>;
type ExecutionContext = {
  waitUntil?(promise: Promise<unknown>): void;
};
type DurableObjectId = unknown;
type DurableObjectStub = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};
type DurableObjectNamespace = {
  get(id: DurableObjectId): DurableObjectStub;
  idFromName(name: string): DurableObjectId;
};

export type LiveControlRequest = {
  connectionId: string;
  operations: Array<LiveControlOperation>;
};

type ParsedControlOperation =
  | {
      index: number;
      ok: true;
      operation: LiveControlOperation;
    }
  | {
      index: number;
      ok: false;
      result: LiveControlOperationResult;
    };

type ParsedLiveControlRequest = {
  connectionId: string;
  operations: Array<ParsedControlOperation>;
};

export type LiveControlOperation =
  | {
      id: string;
      kind: 'subscribe';
      lastEventId?: string;
      topic: string;
    }
  | {
      id: string;
      kind: 'unsubscribe';
    };

export type LiveControlErrorCode =
  | 'BAD_REQUEST'
  | 'CONNECTION_CLOSED'
  | 'CONNECTION_NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_SUBSCRIPTION_ID'
  | 'INVALID_TOPIC'
  | 'OWNER_MISMATCH'
  | 'SUBSCRIPTION_LIMIT'
  | 'TOPIC_FULL'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL_ERROR';

export type LiveControlError = {
  code: LiveControlErrorCode;
  message: string;
};

export type LiveControlOperationResult =
  | {
      id: string;
      kind: 'subscribe' | 'unsubscribe';
      ok: true;
      topic?: string;
    }
  | {
      error: LiveControlError;
      id: string;
      kind: 'subscribe' | 'unsubscribe';
      ok: false;
    };

export type LiveControlResponse =
  | {
      accepted: true;
      connectionId: string;
      results: Array<LiveControlOperationResult>;
    }
  | {
      accepted: false;
      error: LiveControlError;
    };

export type LiveClientEvent<Data = unknown> = {
  data: Data;
  eventId?: string;
  subscriptionId: string;
  topic: string;
  type?: string;
};

export type LivePublishOptions = {
  eventId?: string;
  type?: string;
};

export type LiveConnectOptions = {
  owner?: string | null;
  user?: unknown;
};

export type LiveControlOptions = LiveConnectOptions;

export type CloudflareFateLiveContext<Env = Record<string, unknown>> = {
  ctx?: ExecutionContext;
  env: Env;
  request: Request;
};

export type LiveHookContext<Env = Record<string, unknown>> = {
  env: Env;
  owner: string | null;
  request: Request;
  user: unknown | null;
};

export type LiveConnectHookContext<Env = Record<string, unknown>> = LiveHookContext<Env> & {
  connection: { id: string };
};

export type LiveSubscribeHookContext<Env = Record<string, unknown>> = LiveHookContext<Env> & {
  connection: { id: string };
  lastEventId?: string;
  subscription: { id: string };
  topic: string;
};

export type LiveStreamOptions<Env = Record<string, unknown>> = {
  allowAnonymousControl?: boolean;
  binding?: string;
  id: string;
  identifyConnection?: (ctx: LiveHookContext<Env>) => MaybePromise<string | null | undefined>;
  limits?: Partial<LiveLimits>;
  onConnect?: (ctx: LiveConnectHookContext<Env>) => MaybePromise<Response | void>;
  onSubscribe?: (ctx: LiveSubscribeHookContext<Env>) => MaybePromise<Response | void>;
};

export type LiveLimits = {
  deliveryAttemptTimeoutMs: number;
  maxEncodedEventSize: number;
  maxOperationsPerControlRequest: number;
  maxQueuedEventsPerConnection: number;
  maxSubscriptionsPerConnection: number;
  maxSubscriptionsPerTopic: number;
};

export type LiveStream<Env = Record<string, unknown>> = {
  connect(ctx: CloudflareFateLiveContext<Env>, options?: LiveConnectOptions): Promise<Response>;
  control(ctx: CloudflareFateLiveContext<Env>, options?: LiveControlOptions): Promise<Response>;
  withEnv(env: Env): {
    publish(topic: string, data: unknown, options?: LivePublishOptions): Promise<void>;
  };
};

const DEFAULT_LIVE_BINDING = 'FATE_LIVE';
const registeredStreamIds = new Set<string>();
const DEFAULT_LIMITS: LiveLimits = {
  deliveryAttemptTimeoutMs: 1500,
  maxEncodedEventSize: 64 * 1024,
  maxOperationsPerControlRequest: 100,
  maxQueuedEventsPerConnection: 100,
  maxSubscriptionsPerConnection: 256,
  maxSubscriptionsPerTopic: 256,
};
const MAX_SUBSCRIPTIONS_PER_TOPIC = 256;

export function defineCloudflareFateLiveStream<Env = Record<string, unknown>>(
  options: LiveStreamOptions<Env>,
): LiveStream<Env> {
  const streamId = assertStreamId(options.id);
  const bindingName = assertBindingName(options.binding ?? DEFAULT_LIVE_BINDING);
  const limits = resolveLiveLimits(options.limits);
  if (registeredStreamIds.has(streamId)) {
    throw new Error(`cf-fate: duplicate live stream id "${streamId}".`);
  }
  registeredStreamIds.add(streamId);

  async function resolveOwner(
    ctx: CloudflareFateLiveContext<Env>,
    request: Request,
    connectOptions: LiveConnectOptions | undefined,
  ): Promise<{ owner: string | null; user: unknown | null }> {
    const resolvedUser = connectOptions && 'user' in connectOptions ? connectOptions.user : null;
    const hookContext: LiveHookContext<Env> = {
      env: ctx.env,
      owner: connectOptions?.owner ?? null,
      request,
      user: resolvedUser ?? null,
    };
    const identified =
      connectOptions && 'owner' in connectOptions
        ? connectOptions.owner
        : await options.identifyConnection?.(hookContext);
    const owner = identified ?? defaultOwner(resolvedUser);
    if (owner == null && !options.allowAnonymousControl) {
      throw liveResponseError('FORBIDDEN', 'cf-fate: anonymous control is not enabled.', 403);
    }
    assertOwner(owner);
    return { owner, user: resolvedUser ?? null };
  }

  async function publishWithEnv(
    env: Env,
    topic: string,
    data: unknown,
    publishOptions: LivePublishOptions = {},
  ): Promise<void> {
    const binding = getLiveBinding(env, bindingName);
    assertTopic(topic);
    assertOptionalString('type', publishOptions.type);
    assertOptionalString('eventId', publishOptions.eventId);
    assertJsonSerializable(data);
    const topicKey = await topicDigest(streamId, topic);
    const id = binding.idFromName(topicInstanceName(streamId, topicKey));
    const response = await binding.get(id).fetch(internalUrl('/publish'), {
      body: JSON.stringify({
        streamId,
        topic,
        topicKey,
        data,
        type: publishOptions.type,
        eventId: publishOptions.eventId,
        limits,
      }),
      method: 'POST',
    });
    if (!response.ok) {
      const body = await response.text();
      const parsed = parseLiveControlResponse(body);
      if (parsed && !parsed.accepted) {
        throw new Error(`${parsed.error.code}: ${parsed.error.message}`);
      }
      throw new Error(body || response.statusText);
    }
  }

  return {
    async connect(ctx, connectOptions) {
      try {
        const request = ctx.request;
        const connectionId = getConnectionId(request);
        const { owner, user } = await resolveOwner(ctx, request, connectOptions);
        const decision = await options.onConnect?.({
          connection: { id: connectionId },
          env: ctx.env,
          owner,
          request,
          user,
        });
        if (decision instanceof Response) {
          return decision;
        }
        const binding = getLiveBinding(ctx.env, bindingName);
        const id = binding.idFromName(connectionInstanceName(streamId, connectionId));
        return binding.get(id).fetch(internalUrl('/connect'), {
          body: JSON.stringify({ streamId, connectionId, owner, limits }),
          method: 'POST',
        });
      } catch (error) {
        return errorToResponse(error);
      }
    },

    async control(ctx, controlOptions) {
      try {
        const request = ctx.request;
        const body = await readControlRequest(request, limits);
        const { owner, user } = await resolveOwner(ctx, request, controlOptions);
        const authorized: Array<{ index: number; operation: LiveControlOperation }> = [];
        const results: Array<LiveControlOperationResult | undefined> = [];
        for (const entry of body.operations) {
          if (!entry.ok) {
            results[entry.index] = entry.result;
            continue;
          }
          const { index, operation } = entry;
          if (operation.kind === 'unsubscribe') {
            authorized.push({ index, operation });
            continue;
          }
          const decision = await options.onSubscribe?.({
            connection: { id: body.connectionId },
            env: ctx.env,
            lastEventId: operation.lastEventId,
            owner,
            request,
            subscription: { id: operation.id },
            topic: operation.topic,
            user,
          });
          if (decision instanceof Response) {
            results[index] = {
              error: await responseToControlError(decision),
              id: operation.id,
              kind: 'subscribe',
              ok: false,
            };
            continue;
          }
          authorized.push({ index, operation });
        }
        if (authorized.length > 0) {
          const binding = getLiveBinding(ctx.env, bindingName);
          const id = binding.idFromName(connectionInstanceName(streamId, body.connectionId));
          const response = await binding.get(id).fetch(internalUrl('/control'), {
            body: JSON.stringify({
              streamId,
              connectionId: body.connectionId,
              owner,
              operations: authorized.map((entry) => entry.operation),
              limits,
            }),
            method: 'POST',
          });
          const controlResponse = (await response.json()) as LiveControlResponse;
          if (!controlResponse.accepted) {
            return Response.json(controlResponse, { status: response.status });
          }
          for (const [resultIndex, result] of controlResponse.results.entries()) {
            const operation = authorized[resultIndex];
            if (operation) {
              results[operation.index] = result;
            }
          }
        }
        for (const entry of body.operations) {
          if (!entry.ok) {
            continue;
          }
          const { index, operation } = entry;
          results[index] ??= {
            error: { code: 'INTERNAL_ERROR', message: 'cf-fate: missing control result.' },
            id: operation.id,
            kind: operation.kind,
            ok: false,
          };
        }
        return Response.json({
          accepted: true,
          connectionId: body.connectionId,
          results: results as Array<LiveControlOperationResult>,
        } satisfies LiveControlResponse);
      } catch (error) {
        return errorToResponse(error);
      }
    },

    withEnv(env) {
      return {
        publish(topic, data, publishOptions) {
          return publishWithEnv(env, topic, data, publishOptions);
        },
      };
    },
  };
}

function defaultOwner(user: unknown): string | null {
  if (user && typeof user === 'object' && 'id' in user && typeof user.id === 'string') {
    return `user:${user.id}`;
  }
  return null;
}

function parseLiveControlResponse(body: string): LiveControlResponse | null {
  try {
    const parsed = JSON.parse(body) as LiveControlResponse;
    return typeof parsed === 'object' && parsed !== null && 'accepted' in parsed ? parsed : null;
  } catch {
    return null;
  }
}

async function readControlRequest(
  request: Request,
  limits: LiveLimits,
): Promise<ParsedLiveControlRequest> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw liveResponseError('BAD_REQUEST', 'cf-fate: control request body must be JSON.', 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw liveResponseError('BAD_REQUEST', 'cf-fate: control request body must be an object.', 400);
  }
  const record = body as Record<string, unknown>;
  const connectionId = assertConnectionId(record.connectionId);
  if (!Array.isArray(record.operations)) {
    throw liveResponseError('BAD_REQUEST', 'cf-fate: operations must be an array.', 400);
  }
  if (record.operations.length > limits.maxOperationsPerControlRequest) {
    throw liveResponseError(
      'BAD_REQUEST',
      'cf-fate: too many operations in one control request.',
      400,
    );
  }
  const operations = record.operations.map(parseOperation);
  return { connectionId, operations };
}

function parseOperation(value: unknown, index: number): ParsedControlOperation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw liveResponseError('BAD_REQUEST', 'cf-fate: operation must be an object.', 400);
  }
  const record = value as Record<string, unknown>;
  if (record.kind === 'subscribe') {
    const id = parseBoundedString(record.id, 1, 256);
    if (id == null) {
      return invalidOperation(index, 'subscribe', record.id, 'INVALID_SUBSCRIPTION_ID');
    }
    const topic = parseBoundedString(record.topic, 1, 512);
    if (topic == null) {
      return invalidOperation(index, 'subscribe', id, 'INVALID_TOPIC');
    }
    let lastEventId: string | undefined;
    if (record.lastEventId !== undefined) {
      lastEventId = parseBoundedString(record.lastEventId, 0, 512) ?? undefined;
      if (lastEventId === undefined) {
        return invalidOperation(index, 'subscribe', id, 'BAD_REQUEST');
      }
    }
    return {
      index,
      ok: true,
      operation: {
        id,
        kind: 'subscribe',
        topic,
        ...(lastEventId !== undefined && { lastEventId }),
      },
    };
  }
  if (record.kind === 'unsubscribe') {
    const id = parseBoundedString(record.id, 1, 256);
    if (id == null) {
      return invalidOperation(index, 'unsubscribe', record.id, 'INVALID_SUBSCRIPTION_ID');
    }
    return { index, ok: true, operation: { id, kind: 'unsubscribe' } };
  }
  throw liveResponseError('BAD_REQUEST', 'cf-fate: operation kind is invalid.', 400);
}

function invalidOperation(
  index: number,
  kind: 'subscribe' | 'unsubscribe',
  id: unknown,
  code: LiveControlErrorCode,
): ParsedControlOperation {
  const messages: Record<LiveControlErrorCode, string> = {
    BAD_REQUEST: 'cf-fate: invalid control operation.',
    CONNECTION_CLOSED: 'cf-fate: connection closed.',
    CONNECTION_NOT_FOUND: 'cf-fate: connection not found.',
    FORBIDDEN: 'Forbidden',
    INTERNAL_ERROR: 'cf-fate: internal error.',
    INVALID_SUBSCRIPTION_ID: 'cf-fate: invalid subscription id.',
    INVALID_TOPIC: 'cf-fate: invalid topic.',
    OWNER_MISMATCH: 'cf-fate: owner mismatch.',
    PAYLOAD_TOO_LARGE: 'cf-fate: payload too large.',
    SUBSCRIPTION_LIMIT: 'cf-fate: subscription limit reached.',
    TOPIC_FULL: 'cf-fate: topic subscription limit reached.',
  };
  return {
    index,
    ok: false,
    result: {
      error: { code, message: messages[code] },
      id: typeof id === 'string' ? id : '',
      kind,
      ok: false,
    },
  };
}

function getLiveBinding(env: unknown, bindingName: string): DurableObjectNamespace {
  if (typeof env !== 'object' || env === null) {
    throw new Error('cf-fate: Cloudflare env is unavailable.');
  }
  const binding = (env as Record<string, unknown>)[bindingName] as
    | DurableObjectNamespace
    | undefined;
  if (!binding) {
    throw new Error(`cf-fate: Missing Durable Object binding "${bindingName}".`);
  }
  return binding;
}

function getConnectionId(request: Request): string {
  return assertConnectionId(new URL(request.url).searchParams.get('connectionId'));
}

function assertStreamId(value: unknown): string {
  return assertBoundedString('stream id', value, 1, 128);
}

function assertBindingName(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`cf-fate: invalid Durable Object binding name "${value}".`);
  }
  return value;
}

function assertConnectionId(value: unknown): string {
  return assertBoundedString('connectionId', value, 16, 256);
}

function assertTopic(value: unknown): string {
  return assertBoundedString('topic', value, 1, 512);
}

function assertOwner(value: string | null): void {
  if (value !== null) {
    assertBoundedString('owner', value, 1, 512);
  }
}

function assertOptionalString(name: string, value: unknown): void {
  if (value !== undefined) {
    assertBoundedString(name, value, 1, 512);
  }
}

function resolveLiveLimits(input: Partial<LiveLimits> | undefined): LiveLimits {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(limits) as Array<keyof LiveLimits>) {
    const value = input?.[key];
    if (value === undefined) {
      continue;
    }
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
      throw new Error(`cf-fate: limits.${key} must be a positive finite integer.`);
    }
    limits[key] = value;
  }
  if (limits.maxSubscriptionsPerTopic > MAX_SUBSCRIPTIONS_PER_TOPIC) {
    throw new Error(
      `cf-fate: limits.maxSubscriptionsPerTopic must be at most ${MAX_SUBSCRIPTIONS_PER_TOPIC}.`,
    );
  }
  return limits;
}

function assertBoundedString(name: string, value: unknown, min: number, max: number): string {
  const parsed = parseBoundedString(value, min, max);
  if (parsed == null) {
    throw liveResponseError('BAD_REQUEST', `cf-fate: invalid ${name}.`, 400);
  }
  return parsed;
}

function parseBoundedString(value: unknown, min: number, max: number): string | null {
  if (
    typeof value !== 'string' ||
    value.length < min ||
    value.length > max ||
    /[\r\n]/.test(value) ||
    value.includes('\u0000')
  ) {
    return null;
  }
  return value;
}

function assertJsonSerializable(value: unknown): void {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') {
      throw new Error('unsupported value');
    }
  } catch (error) {
    throw new Error(
      `cf-fate: payload must be JSON-serializable. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

async function topicDigest(streamId: string, topic: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${streamId}\u0000${topic}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const binary = String.fromCharCode(...new Uint8Array(digest));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function connectionInstanceName(streamId: string, connectionId: string): string {
  return `live:${streamId}:connection:${connectionId}`;
}

function topicInstanceName(streamId: string, topicKey: string): string {
  return `live:${streamId}:topic:${topicKey}`;
}

function internalUrl(path: string): string {
  return `https://cf-fate.live${path}`;
}

class LiveResponseError extends Error {
  constructor(
    readonly code: LiveControlErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function liveResponseError(code: LiveControlErrorCode, message: string, status: number): never {
  throw new LiveResponseError(code, message, status);
}

function errorToResponse(error: unknown): Response {
  if (error instanceof LiveResponseError) {
    return Response.json(
      {
        accepted: false,
        error: { code: error.code, message: error.message },
      } satisfies LiveControlResponse,
      { status: error.status },
    );
  }
  return Response.json(
    {
      accepted: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
    } satisfies LiveControlResponse,
    { status: 500 },
  );
}

async function responseToControlError(response: Response): Promise<LiveControlError> {
  const body = await response.text().catch(() => '');
  const message = body || response.statusText;
  if (response.status === 403 || response.status === 401) {
    return { code: 'FORBIDDEN', message: message || 'Forbidden' };
  }
  return { code: 'BAD_REQUEST', message: message || 'Subscription rejected' };
}
