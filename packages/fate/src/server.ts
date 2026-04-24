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
  ViewPlan,
  ViewPlanNode,
} from './server/dataView.ts';
export type {
  ConnectionItem,
  ConnectionPagination,
  ConnectionResult,
} from './server/connection.ts';
export type {
  ExecutionPlan,
  ExecutionPlanNode,
  KeysetStep,
  OrderDirection,
  SourceDefinition,
  SourceOrder,
  SourceOrderField,
  SourceRelation,
} from './server/source.ts';
export type {
  SourceByIdHandler,
  SourceByIdsHandler,
  SourceConnectionHandler,
  SourceExecutor,
  SourceRegistry,
} from './server/executor.ts';

export {
  attachComputedState,
  computed,
  count,
  createResolver,
  createViewPlan,
  dataView,
  field,
  list,
  resolver,
} from './server/dataView.ts';
export { withConnection, connectionArgs } from './server/connection.ts';
export {
  createSourceRegistry,
  executeSourceById,
  executeSourceByIds,
  executeSourceConnection,
  refetchSourceById,
} from './server/executor.ts';
export { byIdInput } from './server/input.ts';
export { toPrismaSelect } from './server/prismaSelect.ts';
export { createSourceProcedureFactory, createSourceProcedures } from './server/sourceRouter.ts';
export {
  asc,
  createExecutionPlan,
  createKeysetSteps,
  createNestedExecutionPlan,
  decodeCursor,
  defineSource,
  desc,
  encodeCursor,
  getSourceOrder,
  getNestedSelection,
  getNestedSourceInput,
  hasNestedSelection,
  many,
  manyToMany,
  one,
} from './server/source.ts';
