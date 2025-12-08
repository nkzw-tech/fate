/**
 * The fate server library.
 *
 * @example
 * import { dataView } from '@nkzw/fate/server';
 *
 * @module @nkzw/fate/server
 */

export type { Entity } from './server/dataView.ts';

export { createResolver, dataView, list, resolver } from './server/dataView.ts';
export { withConnection, connectionArgs } from './server/connection.ts';
export { byIdInput } from './server/input.ts';
