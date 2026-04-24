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
  ComputedNeed,
  CountNeed,
  Entity,
  FieldNeed,
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
  SourceDefinition,
  SourceOrder,
  SourceOrderField,
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
export { bindSourceProcedures, createSourceProcedures } from './server/sourceRouter.ts';
export {
  asc,
  createSourcePlan,
  defineSource,
  desc,
  many,
  manyToMany,
  one,
} from './server/source.ts';
