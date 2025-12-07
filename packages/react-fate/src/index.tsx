/**
 * The react fate library.
 *
 * @example
 * import { useView, view } from 'react-fate';
 *
 * @module react-fate
 */

export {
  createClient,
  createTRPCTransport,
  mutation,
  type ConnectionRef,
  type ViewRef,
  view,
} from '@nkzw/fate';

export { FateClient, useFateClient } from './context.tsx';
export { useView } from './useView.tsx';
export { useRequest } from './useRequest.tsx';
export { useListView } from './useListView.tsx';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ClientMutations {}
