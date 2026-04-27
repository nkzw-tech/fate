/**
 * The react fate library.
 *
 * @example
 * import { useView, view } from 'react-fate';
 *
 * @module react-fate
 */

export {
  clientRoot,
  createClient,
  createHTTPTransport,
  createTRPCTransport,
  mutation,
  toEntityId,
  type ConnectionRef,
  type ViewRef,
  type InferFateAPI,
  view,
} from '@nkzw/fate';

export { FateClient, useFateClient } from './context.tsx';
export { useLiveView } from './useLiveView.tsx';
export { useView } from './useView.tsx';
export { useRequest } from './useRequest.tsx';
export { useListView } from './useListView.tsx';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ClientMutations {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ClientRoots {}
