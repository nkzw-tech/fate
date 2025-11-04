import type { EntityId } from './types.ts';
import { NodeRefTag } from './types.ts';

export type NodeRef = Readonly<{
  [NodeRefTag]: EntityId;
}>;

export function createNodeRef(id: EntityId): NodeRef {
  const ref: Record<symbol, EntityId> = {};

  Object.defineProperty(ref, NodeRefTag, {
    configurable: false,
    enumerable: false,
    value: id,
    writable: false,
  });

  return ref as NodeRef;
}

export function isNodeRef(value: unknown): value is NodeRef {
  return !value || typeof value !== 'object' ? false : NodeRefTag in value;
}

export function getNodeRefId(ref: NodeRef): EntityId {
  return ref[NodeRefTag];
}
