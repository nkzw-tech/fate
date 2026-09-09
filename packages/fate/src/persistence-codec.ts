import { decodeHydrationValue, encodeHydrationValue } from './hydration.ts';
import { isRecord } from './record.ts';
import type {
  ListRequestDescriptor,
  NodeRequestDescriptor,
  QueryRequestDescriptor,
  RequestDescriptor,
  RequestItemDescriptor,
} from './request-descriptor.ts';
import type { SelectionPlan } from './selection.ts';
import type { AnyRecord, ConnectionLivePolicy } from './types.ts';

type Encoded = ReturnType<typeof encodeHydrationValue>;
type SerializedSelectionPlan = {
  args: Array<readonly [string, { hash: string; ignoreKeys?: Array<string>; value: AnyRecord }]>;
  live: Array<readonly [string, ConnectionLivePolicy]>;
  paths: Array<string>;
};
type SerializedNodeRequest = Omit<NodeRequestDescriptor, 'plan' | 'refViewNames'> & {
  plan: SerializedSelectionPlan;
  refViewNames: Array<string>;
};
type SerializedQueryRequest = Omit<QueryRequestDescriptor, 'plan' | 'refViewNames'> & {
  plan: SerializedSelectionPlan;
  refViewNames: Array<string>;
};
type SerializedListRequest = Omit<ListRequestDescriptor, 'nodeRefViewNames' | 'plan'> & {
  nodeRefViewNames: Array<string>;
  plan: SerializedSelectionPlan;
};
type SerializedRequestItem = SerializedListRequest | SerializedNodeRequest | SerializedQueryRequest;
type SerializedRequest = {
  items: Array<SerializedRequestItem>;
  key: string;
};

const isStringArray = (value: unknown): value is Array<string> =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');
const isLivePolicy = (value: unknown): value is ConnectionLivePolicy =>
  isRecord(value) &&
  (value.append === undefined || value.append === 'edge' || value.append === 'visible') &&
  (value.prepend === undefined || value.prepend === 'edge' || value.prepend === 'visible');

const isSerializedPlan = (value: unknown): value is SerializedSelectionPlan =>
  isRecord(value) &&
  Array.isArray(value.args) &&
  value.args.every(
    (entry) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === 'string' &&
      isRecord(entry[1]) &&
      typeof entry[1].hash === 'string' &&
      isRecord(entry[1].value) &&
      (entry[1].ignoreKeys === undefined || isStringArray(entry[1].ignoreKeys)),
  ) &&
  Array.isArray(value.live) &&
  value.live.every(
    (entry) =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === 'string' &&
      isLivePolicy(entry[1]),
  ) &&
  isStringArray(value.paths);

const isSerializedRequest = (value: unknown): value is SerializedRequest =>
  isRecord(value) &&
  typeof value.key === 'string' &&
  Array.isArray(value.items) &&
  value.items.every(
    (item) =>
      isRecord(item) &&
      isSerializedPlan(item.plan) &&
      (item.kind === 'list'
        ? isStringArray(item.nodeRefViewNames)
        : (item.kind === 'node' || item.kind === 'nodes' || item.kind === 'query') &&
          isStringArray(item.refViewNames)),
  );

export const serializePlan = (plan: SelectionPlan): SerializedSelectionPlan => ({
  args: [...plan.args].map(
    ([key, value]) =>
      [
        key,
        { ...value, ignoreKeys: value.ignoreKeys ? [...value.ignoreKeys] : undefined },
      ] as const,
  ),
  live: [...plan.live],
  paths: [...plan.paths],
});

export const deserializePlan = (value: SerializedSelectionPlan): SelectionPlan => ({
  args: new Map(
    value.args.map(([key, entry]) => [
      key,
      { ...entry, ignoreKeys: entry.ignoreKeys ? new Set(entry.ignoreKeys) : undefined },
    ]),
  ),
  live: new Map(value.live),
  paths: new Set(value.paths),
});

export const encodeRequests = (requests: ReadonlyArray<RequestDescriptor>) =>
  encodeHydrationValue(
    requests.map((request) => ({
      ...request,
      items: request.items.map((item) => ({
        ...item,
        plan: serializePlan(item.plan),
        ...('refViewNames' in item
          ? { refViewNames: [...item.refViewNames] }
          : { nodeRefViewNames: [...item.nodeRefViewNames] }),
      })),
    })),
  );

const decodeItem = (item: SerializedRequestItem): RequestItemDescriptor =>
  item.kind === 'list'
    ? {
        ...item,
        nodeRefViewNames: new Set(item.nodeRefViewNames),
        plan: deserializePlan(item.plan),
      }
    : {
        ...item,
        plan: deserializePlan(item.plan),
        refViewNames: new Set(item.refViewNames),
      };

export const decodeRequests = (value: Encoded): Array<RequestDescriptor> => {
  const requests: unknown = decodeHydrationValue(value);
  if (!Array.isArray(requests) || !requests.every(isSerializedRequest)) {
    throw new Error('fate: Invalid persisted request descriptors.');
  }
  return requests.map((request) => ({
    ...request,
    items: request.items.map(decodeItem),
  }));
};
