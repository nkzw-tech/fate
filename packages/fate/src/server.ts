/**
 * The fate server library.
 *
 * @example
 * import { dataView } from '@nkzw/fate/server';
 *
 * @module @nkzw/fate/server
 */

export type {
  ComputedField,
  ComputedSelection,
  CountSelection,
  DataViewListOptions,
  DataViewOrderBy,
  DataViewOrderDirection,
  Entity,
  FieldSelection,
} from './server/dataView.ts';
export type {
  ConnectionItem,
  ConnectionPagination,
  ConnectionResult,
} from './server/connection.ts';
export type {
  SourcePlan,
  SourcePlanNode,
  OrderDirection,
  SourceConfig,
  SourceDefinition,
  SourceOrder,
  SourceOrderField,
  SourceRelationConfig,
  SourceRelation,
} from './server/source.ts';
export type { SourceRegistry } from './server/executor.ts';

export {
  computed,
  count,
  createResolver,
  dataView,
  field,
  list,
  resolver,
} from './server/dataView.ts';
export { withConnection, connectionArgs } from './server/connection.ts';
export {
  resolveSourceById,
  resolveSourceByIds,
  resolveSourceConnection,
  refetchSourceById,
} from './server/executor.ts';
export { byIdInput } from './server/input.ts';
export { toPrismaSelect } from './server/prismaSelect.ts';
export { isRecord } from './record.ts';
export { bindSourceProcedures, createSourceProcedures } from './server/sourceRouter.ts';
export { createSourcePlan } from './server/source.ts';
