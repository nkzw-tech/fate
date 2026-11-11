/**
 * React bindings for the fate devtools.
 *
 * @example
 * import { FateDevtools } from '@nkzw/fate-devtools/react';
 *
 * <FateClient client={fate}>
 *   {import.meta.env.DEV && <FateDevtools />}
 *   <App />
 * </FateClient>
 *
 * @module @nkzw/fate-devtools/react
 */

import type { FateClient } from '@nkzw/fate';
import { useEffect } from 'react';
import { useFateClient } from 'react-fate';
import { connectFateDevtools, type FateDevtoolsOptions } from './index.ts';

/**
 * Connects a fate client to the devtools while the calling component is mounted.
 */
export function useFateDevtools(
  client: FateClient<any, any, any>,
  { logSize, name }: FateDevtoolsOptions = {},
): void {
  useEffect(() => connectFateDevtools(client, { logSize, name }), [client, logSize, name]);
}

/**
 * Connects the client from the nearest `<FateClient>` to the devtools. Renders nothing.
 */
export function FateDevtools(props: FateDevtoolsOptions): null {
  useFateDevtools(useFateClient(), props);
  return null;
}
