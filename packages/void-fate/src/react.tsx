import type { FateClient as FateClientType } from '@nkzw/fate';
import { type ReactNode, useMemo } from 'react';
import { FateClient } from 'react-fate';
import { createFateClient as createGeneratedFateClient } from 'react-fate/client';

export type VoidFateClientProps = {
  children: ReactNode;
  fetch?: typeof fetch;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  livePath?: string;
  liveRetryMs?: number;
  liveUrl?: string | URL;
  onLiveError?: (error: unknown) => void;
  origin?: string | URL;
  rpcPath?: string;
  url?: string | URL;
  userId?: null | string;
};

type CreateVoidFateClientOptions = Omit<VoidFateClientProps, 'children'>;

const createVoidFateClient = createGeneratedFateClient as unknown as (
  options?: CreateVoidFateClientOptions,
) => FateClientType<any, any>;

export function VoidFateClient({
  children,
  fetch,
  headers,
  livePath,
  liveRetryMs,
  liveUrl,
  onLiveError,
  origin,
  rpcPath,
  url,
  userId,
}: VoidFateClientProps) {
  const fate = useMemo(
    () =>
      createVoidFateClient({
        fetch,
        headers,
        livePath,
        liveRetryMs,
        liveUrl,
        onLiveError,
        origin,
        rpcPath,
        url,
        userId,
      }),
    [fetch, headers, livePath, liveRetryMs, liveUrl, onLiveError, origin, rpcPath, url, userId],
  );

  return (
    <FateClient client={fate} key={userId ?? undefined}>
      {children}
    </FateClient>
  );
}
