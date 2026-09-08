import { decodeHydrationValue, encodeHydrationValue } from './hydration.ts';
import type { RequestDescriptor } from './request-descriptor.ts';
import type { SelectionPlan } from './selection.ts';
type Encoded = ReturnType<typeof encodeHydrationValue>;

export const serializePlan = (plan: SelectionPlan) => ({
  args: [...plan.args].map(([key, value]) => [
    key,
    { ...value, ignoreKeys: value.ignoreKeys ? [...value.ignoreKeys] : undefined },
  ]),
  live: [...plan.live],
  paths: [...plan.paths],
});

export const deserializePlan = (value: ReturnType<typeof serializePlan>): SelectionPlan => ({
  args: new Map(
    (
      value.args as Array<
        [string, { hash: string; ignoreKeys?: Array<string>; value: Record<string, unknown> }]
      >
    ).map(([key, entry]) => [
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

export const decodeRequests = (value: Encoded): Array<RequestDescriptor> =>
  (decodeHydrationValue(value) as Array<{ items: Array<Record<string, any>>; key: string }>).map(
    (request) => ({
      ...request,
      items: request.items.map((item) => ({
        ...item,
        plan: deserializePlan(item.plan),
        ...('refViewNames' in item
          ? { refViewNames: new Set(item.refViewNames) }
          : { nodeRefViewNames: new Set(item.nodeRefViewNames) }),
      })) as unknown as RequestDescriptor['items'],
    }),
  );
