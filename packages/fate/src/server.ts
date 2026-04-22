/**
 * The fate server library.
 *
 * @example
 * import { dataView } from '@nkzw/fate/server';
 *
 * @module @nkzw/fate/server
 */

export type { Entity, ViewPlan, ViewPlanNode } from './server/dataView.ts';
export type {
  ConnectionItem,
  ConnectionPagination,
  ConnectionResult,
} from './server/connection.ts';

export { createResolver, createViewPlan, dataView, list, resolver } from './server/dataView.ts';
export { withConnection, connectionArgs } from './server/connection.ts';
export { byIdInput } from './server/input.ts';
export { toPrismaSelect } from './server/prismaSelect.ts';
