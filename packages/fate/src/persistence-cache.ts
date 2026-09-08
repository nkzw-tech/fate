import { filterConnectionArgs } from './args.ts';
import type { FateClient } from './client.ts';
import {
  decodeClientHydrationState,
  decodeHydrationValue,
  encodeHydrationValue,
  type ClientHydrationState,
  type FateDehydratedState,
} from './hydration.ts';
import type { MutationCommand } from './mutation.ts';
import { createNodeRef, getNodeRefId, isNodeRef } from './node-ref.ts';
import { decodeRequests, encodeRequests } from './persistence-codec.ts';
import type { PersistenceStorage } from './persistence.ts';
import { toEntityId } from './ref.ts';
import type { RequestDescriptor } from './request-descriptor.ts';
import type { SelectionPlan } from './selection.ts';
import { getListKey, type List } from './store.ts';
import type { AnyRecord } from './types.ts';

type Encoded = ReturnType<typeof encodeHydrationValue>;
type Claim = { expiresAt: number; fetchedAt: number; paths: Array<string> };
type Node = { claims: Record<string, Claim>; value: Encoded };
type Root = {
  fetchedAt: number;
  maxAge: number;
  nodes: Array<string>;
  request: Encoded;
  usedAt: number;
};
type Sized<T> = { bytes: number; value: T };
type RecordValue = { paths: Array<string>; record: AnyRecord };
type CacheUpdate = { fields?: Array<string>; previousList?: List; value: unknown };
const mergeCacheUpdate = (
  key: string,
  before: CacheUpdate | undefined,
  after: CacheUpdate,
): CacheUpdate => ({
  fields:
    after.fields && (!before || before.fields)
      ? [...new Set([...(before?.fields ?? []), ...after.fields])]
      : undefined,
  previousList: before ? before.previousList : after.previousList,
  value:
    key.startsWith('r:') && before?.value && after.value
      ? applyRecordUpdate(
          before.value as RecordValue,
          after.value as RecordValue,
          after.fields ? new Set(after.fields) : undefined,
        )
      : after.value,
});
const encoder = new TextEncoder();
const sized = (key: string, value: unknown): Sized<unknown> => {
  const item = { bytes: 0, value };
  for (;;) {
    const bytes = encoder.encode(JSON.stringify([key, item])).byteLength;
    if (bytes === item.bytes) {
      return item;
    }
    item.bytes = bytes;
  }
};
const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const stamp = (time: number) => String(time).padStart(16, '0');
const recordKey = (id: string) => `r:${id}`;
const listKey = (id: string) => `l:${id}`;
const queryKey = (id: string) => `q:${id}`;
const matches = (path: string, selected: string) =>
  path === selected || path.startsWith(`${selected}.`) || selected.startsWith(`${path}.`);
const project = (value: RecordValue, paths: Array<string>): RecordValue => {
  const fields = new Set(['id', '__typename', ...paths.map((path) => path.split('.')[0])]);
  return {
    paths: value.paths.filter((path) => paths.some((selected) => matches(path, selected))),
    record: Object.fromEntries(Object.entries(value.record).filter(([field]) => fields.has(field))),
  };
};

const applyRecordUpdate = (
  before: RecordValue,
  after: RecordValue,
  fields?: Set<string>,
): RecordValue => ({
  paths: [
    ...new Set([
      ...before.paths,
      ...after.paths.filter((path) => !fields || fields.has(path.split('.')[0])),
    ]),
  ],
  record: {
    ...before.record,
    ...Object.fromEntries(
      Object.entries(after.record).filter(([key]) => !fields || fields.has(key)),
    ),
  },
});

// Apply this tab's membership changes to the latest saved list. Common IDs
// missing from disk were removed by another tab and must not be resurrected.
const mergeIds = (
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
  latest: ReadonlyArray<string>,
): Array<string> => {
  const old = new Set(before);
  const next = new Set(after);
  let retained = latest.filter((id) => !old.has(id) || next.has(id));
  const present = new Set(retained);
  const oldOrder = before.filter((id) => next.has(id));
  const nextOrder = after.filter((id) => old.has(id));
  if (oldOrder.some((id, index) => id !== nextOrder[index])) {
    let index = 0;
    const reordered = nextOrder.filter((id) => present.has(id));
    retained = retained.map((id) => (old.has(id) ? reordered[index++] : id));
  }
  const insertions = new Map<string | undefined, Array<string>>();
  let anchor: string | undefined;
  for (let index = after.length - 1; index >= 0; index--) {
    const id = after[index];
    if (present.has(id)) {
      anchor = id;
    } else if (!old.has(id)) {
      const group = insertions.get(anchor) ?? [];
      group.push(id);
      insertions.set(anchor, group);
      present.add(id);
    }
  }
  return [
    ...retained.flatMap((id) => [...(insertions.get(id)?.reverse() ?? []), id]),
    ...(insertions.get(undefined)?.reverse() ?? []),
  ];
};

const membershipFields = [
  'ids',
  'liveAfterIds',
  'liveBeforeIds',
  'pendingAfterIds',
  'pendingBeforeIds',
] as const;
const applyListUpdate = (latest: List, before: List, after: List): List => {
  const previousMembers = new Set(membershipFields.flatMap((field) => before[field] ?? []));
  const latestMembers = new Set(membershipFields.flatMap((field) => latest[field] ?? []));
  const surviving = (ids: ReadonlyArray<string>) =>
    ids.filter((id) => !previousMembers.has(id) || latestMembers.has(id));
  const ids = mergeIds(before.ids, surviving(after.ids), latest.ids);
  const oldCursors = new Map(before.ids.map((id, index) => [id, before.cursors?.[index]]));
  const nextCursors = new Map(after.ids.map((id, index) => [id, after.cursors?.[index]]));
  const cursors = new Map(latest.ids.map((id, index) => [id, latest.cursors?.[index]]));
  for (const [id, cursor] of nextCursors) {
    if (!oldCursors.has(id) || oldCursors.get(id) !== cursor) {
      cursors.set(id, cursor);
    }
  }
  const result = { ...latest, ids };
  if (latest.cursors || after.cursors) {
    result.cursors = ids.map((id) => cursors.get(id));
  }
  for (const field of [
    'liveAfterIds',
    'liveBeforeIds',
    'pendingAfterIds',
    'pendingBeforeIds',
  ] as const) {
    if (before[field] || after[field] || latest[field]) {
      result[field] = mergeIds(
        before[field] ?? [],
        surviving(after[field] ?? []),
        latest[field] ?? [],
      );
    }
  }
  for (const field of ['backwardPageLimit', 'forwardPageLimit'] as const) {
    if (before[field] !== after[field]) {
      result[field] = after[field];
    }
  }
  if (after.pagination) {
    result.pagination = {
      ...(latest.pagination ?? after.pagination),
      ...Object.fromEntries(
        Object.entries(after.pagination).filter(
          ([key, value]) =>
            value !== before.pagination?.[key as keyof NonNullable<List['pagination']>],
        ),
      ),
    };
  }
  return result;
};

const references = (value: unknown): string => {
  if (isNodeRef(value)) {
    return JSON.stringify(['ref', getNodeRefId(value)]);
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value.map(references));
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(Object.entries(value).map(([key, entry]) => [key, references(entry)]));
  }
  return '';
};

/** Independently addressable normalized disk data. No in-memory retention roots. */
export class PersistenceCache {
  private readonly prefix: string;
  private changed = new Map<string, unknown>();
  private updates = new Map<string, unknown>();
  private listBases = new Map<string, List | undefined>();
  private updateListBases = new Map<string, List | undefined>();
  private fields = new Map<string, Set<string> | undefined>();
  private updateFields = new Map<string, Set<string> | undefined>();
  private capturing?: Map<string, CacheUpdate>;
  private recoveryChanges = new Map<string, CacheUpdate>();
  private pending = new Map<
    string,
    { fetchedAt?: number; maxAge: number; release: () => void; request: RequestDescriptor }
  >();
  private suppressed = false;
  private disposed = false;
  private work = 0;
  private journalBytes = 0;
  private policies = new WeakMap<RequestDescriptor, number>();

  constructor(
    private readonly client: FateClient<any, any, any>,
    private readonly storage: PersistenceStorage,
    private readonly key: string,
    private readonly maxAge: number,
    private readonly maxBytes: number,
  ) {
    this.prefix = `${JSON.stringify([key, 'cache-v2'])}:`;
  }

  async initialize() {
    await this.storage.exclusive(`${this.key}:write`, async () => {
      this.assertActive();
      const scope = await this.read<string>(`${this.prefix}scope`);
      if (scope !== this.client.getPersistenceScope()) {
        await this.clear();
        if (
          sized(`${this.prefix}scope`, this.client.getPersistenceScope()).bytes + this.overhead <=
          this.maxBytes
        ) {
          await this.put([[`${this.prefix}scope`, this.client.getPersistenceScope()]]);
        }
      }
    });
  }

  private assertActive() {
    if (this.disposed) {
      throw new Error('fate: Persistence was disposed.');
    }
  }

  private async active() {
    this.assertActive();
    const scope = await this.read<string>(`${this.prefix}scope`);
    this.assertActive();
    return scope === this.client.getPersistenceScope();
  }

  restoreBase(state: ClientHydrationState) {
    this.assertActive();
    this.suppressed = true;
    try {
      this.client.restorePersistenceData(state);
    } finally {
      this.suppressed = false;
    }
  }

  /** Save only recovery dependencies, never an unrelated read-cache snapshot. */
  async mutationBase(
    command: MutationCommand,
    base?: FateDehydratedState,
  ): Promise<FateDehydratedState> {
    const previous = base ? decodeClientHydrationState(base.data).store : undefined;
    const previousRecords = new Map(previous?.records);
    const previousCoverage = new Map(previous?.coverage);
    const previousLists = new Map(previous?.lists);
    const ids = new Set<string>(previousRecords.keys());
    const config = this.client.getTypeConfig(command.entity);
    for (const input of [command.input, command.optimistic]) {
      if (input) {
        try {
          const id = config.getId(input);
          if (id != null) {
            ids.add(toEntityId(command.entity, id));
          }
        } catch {
          /* Creates can omit the ID. */
        }
      }
    }
    const lists = new Set([
      ...previousLists.keys(),
      ...(command.insert !== 'none' ? this.client.getPersistenceRootLists(command.entity) : []),
    ]);
    for (const id of ids) {
      const owners = this.client.store.getPersistenceOwners(id);
      for (const owner of owners.records) {
        ids.add(owner);
      }
      for (const key of owners.lists) {
        lists.add(key);
      }
    }
    const records: Array<readonly [string, AnyRecord]> = [];
    const coverage: Array<readonly [string, Array<string>]> = [];
    const visit = (value: unknown) => {
      if (isNodeRef(value)) {
        ids.add(getNodeRefId(value));
      } else if (Array.isArray(value)) {
        for (const item of value) {
          visit(item);
        }
      } else if (value && typeof value === 'object') {
        for (const item of Object.values(value)) {
          visit(item);
        }
      }
    };
    for (const id of ids) {
      const key = recordKey(id);
      const saved = previousRecords.get(id);
      const before = saved
        ? { paths: [...(previousCoverage.get(id) ?? [])], record: saved }
        : undefined;
      const memory = this.client.store.readConfirmed(id);
      const disk = memory || before ? undefined : await this.node(key);
      const recovery = this.recoveryChanges.get(key);
      const changed = this.changed.has(key);
      const update = changed
        ? mergeCacheUpdate(key, recovery, {
            fields: this.fields.get(key) ? [...this.fields.get(key)!] : undefined,
            value: this.changed.get(key),
          })
        : recovery;
      const incoming = update?.value as RecordValue | undefined;
      const value = update
        ? incoming &&
          (before
            ? applyRecordUpdate(
                before,
                incoming,
                update.fields ? new Set(update.fields) : undefined,
              )
            : incoming)
        : (before ??
          memory ??
          (disk ? (decodeHydrationValue(disk.value) as RecordValue) : undefined));
      if (value) {
        records.push([id, value.record]);
        coverage.push([id, value.paths]);
        visit(value.record);
        for (const [field, entry] of Object.entries(value.record)) {
          if (Array.isArray(entry)) {
            for (const [key] of this.client.store.getListsForField(id, field)) {
              lists.add(key);
            }
          }
        }
      }
      await this.step();
    }
    const listValues: Array<readonly [string, List]> = [];
    for (const key of lists) {
      const value = this.changed.has(listKey(key))
        ? (this.changed.get(listKey(key)) as List | undefined)
        : this.recoveryChanges.has(listKey(key))
          ? (this.recoveryChanges.get(listKey(key))!.value as List | undefined)
          : (previousLists.get(key) ?? this.client.store.readConfirmedList(key));
      if (value) {
        listValues.push([key, value]);
      }
      await this.step();
    }
    return {
      data: encodeHydrationValue({
        rootLists: [[command.entity, [...this.client.getPersistenceRootLists(command.entity)]]],
        rootRequests: [],
        store: { coverage, lists: listValues, records },
      }),
      scope: this.client.getPersistenceScope(),
      version: 1,
    };
  }

  private get overhead() {
    return encoder.encode(JSON.stringify([`${this.prefix}bytes`, this.maxBytes])).byteLength;
  }

  private async step() {
    this.assertActive();
    if (++this.work % 64 === 0) {
      await yieldTask();
      this.assertActive();
    }
  }
  private nodeKey(key: string) {
    return `${this.prefix}node:${key}`;
  }
  private rootKey(key: string) {
    return `${this.prefix}root:${key}`;
  }
  private async read<T>(key: string): Promise<T | undefined> {
    return ((await this.storage.read(key)) as Sized<T> | undefined)?.value;
  }
  private async put(entries: ReadonlyArray<readonly [string, unknown]>) {
    let bytes = ((await this.storage.read(`${this.prefix}bytes`)) as number | undefined) ?? 0;
    const writes: Array<readonly [string, unknown]> = [];
    for (const [key, value] of new Map(entries)) {
      const previous = (await this.storage.read(key)) as Sized<unknown> | undefined;
      bytes -= previous?.bytes ?? 0;
      if (value === undefined) {
        writes.push([key, undefined]);
      } else {
        const item = sized(key, value);
        bytes += item.bytes;
        writes.push([key, item]);
      }
      await this.step();
    }
    writes.push([`${this.prefix}bytes`, Math.max(0, bytes)]);
    this.assertActive();
    await this.storage.writeBatch(writes);
  }

  get hasChanges() {
    return this.changed.size > 0 || this.recoveryChanges.size > 0;
  }

  changedNode(
    kind?: 'record' | 'list',
    key?: string,
    paths?: Iterable<string>,
    previousList?: List,
  ) {
    if (!this.suppressed && key) {
      const selected = paths ? new Set([...paths].map((path) => path.split('.')[0])) : undefined;
      if (kind === 'record') {
        const id = recordKey(key);
        const previous = this.fields.get(id);
        this.fields.set(
          id,
          selected?.size && (!this.fields.has(id) || previous)
            ? new Set([...(previous ?? []), ...selected])
            : undefined,
        );
      }
      const id = kind === 'record' ? recordKey(key) : listKey(key);
      const value =
        kind === 'record'
          ? this.client.store.readConfirmed(key)
          : this.client.store.readConfirmedList(key);
      if (kind === 'list' && !this.changed.has(id)) {
        this.listBases.set(id, previousList);
      }
      this.changed.set(id, value);
      if (this.capturing) {
        const previous = this.capturing.get(id);
        this.capturing.set(id, {
          fields:
            selected?.size && (!previous || previous.fields)
              ? [...new Set([...(previous?.fields ?? []), ...selected])]
              : undefined,
          previousList: previous ? previous.previousList : previousList,
          value,
        });
      }
      return true;
    }
    return false;
  }

  /** A recovered receipt has already been checkpointed by another tab. */
  withoutChanges(commit: () => void) {
    this.suppressed = true;
    try {
      commit();
    } finally {
      this.suppressed = false;
    }
  }

  /** Capture only the confirmed writes made by this mutation for crash recovery. */
  captureChanges(commit: () => void): Encoded {
    const changes = new Map<string, CacheUpdate>();
    this.capturing = changes;
    try {
      commit();
    } finally {
      this.capturing = undefined;
    }
    // Confirmed mutation writes belong to the receipt journal. Keeping a second
    // dirty copy here could replay them after another tab checkpoints the receipt.
    for (const [key, update] of changes) {
      changes.set(key, {
        fields: this.fields.get(key) ? [...this.fields.get(key)!] : undefined,
        previousList: this.listBases.has(key) ? this.listBases.get(key) : update.previousList,
        value: this.changed.get(key),
      });
      this.changed.delete(key);
      this.fields.delete(key);
      this.listBases.delete(key);
    }
    return encodeHydrationValue([...changes]);
  }

  replayChanges(updates: ReadonlyArray<Encoded>) {
    this.recoveryChanges.clear();
    for (const encoded of updates) {
      for (const [key, update] of decodeHydrationValue(encoded) as Array<[string, CacheUpdate]>) {
        this.recoveryChanges.set(key, mergeCacheUpdate(key, this.recoveryChanges.get(key), update));
      }
    }
  }

  fetched(request: RequestDescriptor, maxAge = this.maxAge, fromNetwork = true) {
    if (
      !Number.isSafeInteger(maxAge) ||
      maxAge < 0 ||
      maxAge > Number.MAX_SAFE_INTEGER - Date.now()
    ) {
      throw new Error('fate: Persistence maxAge must be a non-negative finite duration.');
    }
    if (!fromNetwork && this.policies.get(request) === maxAge) {
      return;
    }
    this.policies.set(request, maxAge);
    const previous = this.pending.get(request.key);
    // Keep only the request being copied alive until its incremental write finishes.
    const retain = this.client.retainPersistenceRequest(request);
    previous?.release();
    this.pending.set(request.key, {
      fetchedAt: fromNetwork ? Date.now() : previous?.fetchedAt,
      maxAge,
      release: retain.dispose,
      request,
    });
  }

  private async node(key: string): Promise<Node | undefined> {
    const node = await this.read<Node>(this.nodeKey(key));
    if (!node) {
      return;
    }
    node.claims = Object.fromEntries(
      Object.entries(node.claims).filter(([, claim]) => claim.expiresAt > Date.now()),
    );
    if (!Object.keys(node.claims).length) {
      return;
    }
    if (key.startsWith('r:')) {
      const paths = Object.values(node.claims).flatMap((claim) => claim.paths);
      node.value = encodeHydrationValue(
        project(decodeHydrationValue(node.value) as RecordValue, paths),
      );
    }
    return node;
  }

  /** Walk only the requested selection, yielding between small pieces of work. */
  private async collect(request: RequestDescriptor, memory: boolean, fromNetwork = false) {
    const nodes = new Map<string, { paths: Set<string>; value: unknown }>();
    const visited = new Map<SelectionPlan, Map<string, Set<string>>>();
    let complete = true;
    let fetchedAt = Infinity;
    const queue: Array<{ id: string; paths: Array<string>; plan: SelectionPlan; prefix: string }> =
      [];
    const read = async (key: string): Promise<unknown> => {
      await this.step();
      if (memory) {
        if (this.updates.has(key)) {
          const incoming = this.updates.get(key);
          const base = this.updateListBases.get(key);
          if (!fromNetwork && incoming && base && key.startsWith('l:')) {
            const stored = await this.node(key);
            if (stored) {
              return applyListUpdate(
                decodeHydrationValue(stored.value) as List,
                base,
                incoming as List,
              );
            }
          }
          if (incoming && key.startsWith('r:') && this.updateFields.get(key)) {
            const stored = await this.node(key);
            if (stored) {
              return applyRecordUpdate(
                decodeHydrationValue(stored.value) as RecordValue,
                incoming as RecordValue,
                this.updateFields.get(key),
              );
            }
          }
          return incoming;
        }
        if (fromNetwork) {
          const id = key.slice(2);
          const value = key.startsWith('r:')
            ? this.client.store.readConfirmed(id)
            : key.startsWith('l:')
              ? this.client.store.readConfirmedList(id)
              : this.client.getPersistenceQuery(id);
          if (value !== undefined) {
            return value;
          }
          if (this.changed.has(key)) {
            return undefined;
          }
        }
      }
      const stored = await this.node(key);
      if (stored) {
        for (const claim of Object.values(stored.claims)) {
          fetchedAt = Math.min(fetchedAt, claim.fetchedAt);
        }
      }
      if (!stored) {
        // A newly inserted branch can reference an unchanged in-memory record
        // whose last disk claim was evicted. Existing disk values always win.
        return memory && key.startsWith('r:')
          ? this.client.store.readConfirmed(key.slice(2))
          : undefined;
      }
      const value = decodeHydrationValue(stored.value);
      if (!memory) {
        return value;
      }
      const deleted = (id: string) =>
        this.updates.has(recordKey(id)) && this.updates.get(recordKey(id)) === undefined;
      if (key.startsWith('l:')) {
        const list = value as List;
        return {
          ...list,
          cursors: list.cursors?.filter((_, index) => !deleted(list.ids[index])),
          ids: list.ids.filter((id) => !deleted(id)),
          liveAfterIds: list.liveAfterIds?.filter((id) => !deleted(id)),
          liveBeforeIds: list.liveBeforeIds?.filter((id) => !deleted(id)),
          pendingAfterIds: list.pendingAfterIds?.filter((id) => !deleted(id)),
          pendingBeforeIds: list.pendingBeforeIds?.filter((id) => !deleted(id)),
        };
      }
      if (key.startsWith('r:')) {
        const record = value as RecordValue;
        return {
          ...record,
          record: Object.fromEntries(
            Object.entries(record.record).map(([field, value]) => [
              field,
              isNodeRef(value) && deleted(getNodeRefId(value))
                ? null
                : Array.isArray(value)
                  ? value.filter((item) => !isNodeRef(item) || !deleted(getNodeRefId(item)))
                  : value,
            ]),
          ),
        };
      }
      return typeof value === 'string' && deleted(value) ? null : value;
    };
    const addList = async (
      key: string,
      paths: Array<string>,
      plan: SelectionPlan,
      prefix: string,
    ) => {
      const list = (await read(listKey(key))) as List | undefined;
      if (!list) {
        complete = false;
        return;
      }
      nodes.set(listKey(key), { paths: new Set(), value: list });
      for (const id of [
        ...list.ids,
        ...(list.pendingBeforeIds ?? []),
        ...(list.pendingAfterIds ?? []),
        ...(list.liveBeforeIds ?? []),
        ...(list.liveAfterIds ?? []),
      ]) {
        queue.push({ id, paths, plan, prefix });
      }
    };
    for (const item of request.items) {
      const paths = [...item.plan.paths];
      if (item.kind === 'node' || item.kind === 'nodes') {
        for (const id of item.ids) {
          queue.push({ id: toEntityId(item.type, id), paths, plan: item.plan, prefix: '' });
        }
      } else if (item.kind === 'query') {
        const id = await read(queryKey(item.queryKey));
        if (id === undefined) {
          complete = false;
          continue;
        }
        nodes.set(queryKey(item.queryKey), { paths: new Set(), value: id });
        if (typeof id === 'string') {
          queue.push({ id, paths, plan: item.plan, prefix: '' });
        }
      } else if (item.kind === 'list') {
        await addList(item.listKey, paths, item.plan, '');
      }
    }
    for (let index = 0; index < queue.length; index++) {
      const { id, paths, plan, prefix } = queue[index];
      const key = recordKey(id);
      const seen = nodes.get(key);
      const contexts = visited.get(plan) ?? new Map<string, Set<string>>();
      visited.set(plan, contexts);
      const context = JSON.stringify([id, prefix]);
      const traversed = contexts.get(context);
      const needed = paths.filter((path) => !traversed?.has(path));
      if (traversed && !needed.length) {
        continue;
      }
      contexts.set(context, new Set([...(traversed ?? []), ...paths]));
      const source = (await read(key)) as RecordValue | undefined;
      if (!source) {
        complete = false;
        continue;
      }
      if (
        paths.some(
          (path) =>
            !source.paths.some((covered) => path === covered || path.startsWith(`${covered}.`)),
        )
      ) {
        complete = false;
      }
      const all = new Set([...(seen?.paths ?? []), ...paths]);
      nodes.set(key, { paths: all, value: project(source, [...all]) });
      const groups = new Map<string, Array<string>>();
      for (const path of needed) {
        const [field, ...rest] = path.split('.');
        const children = groups.get(field) ?? [];
        if (rest.length) {
          children.push(rest.join('.'));
        }
        groups.set(field, children);
      }
      const walk = (value: unknown, children: Array<string>, childPrefix: string) => {
        if (isNodeRef(value)) {
          queue.push({ id: getNodeRefId(value), paths: children, plan, prefix: childPrefix });
        } else if (Array.isArray(value)) {
          for (const item of value) {
            walk(item, children, childPrefix);
          }
        } else if (value && typeof value === 'object' && children.length) {
          for (const child of children) {
            const [field, ...rest] = child.split('.');
            walk(
              (value as AnyRecord)[field],
              rest.length ? [rest.join('.')] : [],
              `${childPrefix}.${field}`,
            );
          }
        }
      };
      for (const [field, children] of groups) {
        const childPrefix = prefix ? `${prefix}.${field}` : field;
        const value = source.record[field];
        if (Array.isArray(value)) {
          const nestedKey = getListKey(id, field, plan.args.get(childPrefix)?.hash);
          const list = (await read(listKey(nestedKey))) as List | undefined;
          if (list) {
            const node = nodes.get(key)!;
            const projected = node.value as RecordValue;
            projected.record[field] = list.ids.map(createNodeRef);
            await addList(nestedKey, children, plan, childPrefix);
          } else {
            walk(value, children, childPrefix);
          }
        } else {
          walk(value, children, childPrefix);
        }
      }
    }
    return { complete, fetchedAt, nodes };
  }

  async restore(request: RequestDescriptor) {
    await this.storage.exclusive(`${this.key}:write`, async () => {
      if (!(await this.active())) {
        return;
      }
      const { complete, nodes } = await this.collect(request, false);
      if (!complete) {
        return;
      }
      {
        for (const [key, node] of nodes) {
          this.assertActive();
          const id = key.slice(2);
          const state: ClientHydrationState = {
            rootLists: [],
            rootRequests: [],
            store: { coverage: [], lists: [], records: [] },
          };
          if (key.startsWith('r:')) {
            const value = node.value as RecordValue;
            (state.store.records as Array<unknown>).push([id, value.record]);
            (state.store.coverage as Array<unknown>).push([id, value.paths]);
          } else if (key.startsWith('l:')) {
            (state.store.lists as Array<unknown>).push([id, node.value]);
            for (const item of request.items) {
              if (
                item.kind === 'list' &&
                item.listKey === id &&
                !filterConnectionArgs(item.argsPayload)
              ) {
                (state.rootLists as Array<unknown>).push([item.type, [id]]);
              }
            }
          } else {
            (state.rootRequests as Array<unknown>).push([id, node.value]);
          }
          this.suppressed = true;
          try {
            this.client.restorePersistenceData(state);
          } finally {
            this.suppressed = false;
          }
          await this.step();
        }
      }
      const root = await this.read<Root>(this.rootKey(request.key));
      if (root && root.fetchedAt + root.maxAge > Date.now()) {
        const old = `${this.prefix}lru:${stamp(root.usedAt)}:${request.key}`;
        root.usedAt = Date.now();
        await this.put([
          [old, undefined],
          [this.rootKey(request.key), root],
          [`${this.prefix}lru:${stamp(root.usedAt)}:${request.key}`, request.key],
        ]);
      }
    });
  }

  private async remove(rootId: string) {
    const root = await this.read<Root>(this.rootKey(rootId));
    if (!root) {
      return;
    }
    // Batches can be interrupted safely: losing a cache claim only causes a miss.
    for (const key of root.nodes) {
      const node = await this.read<Node>(this.nodeKey(key));
      if (node) {
        delete node.claims[rootId];
        const live = Object.values(node.claims).filter((claim) => claim.expiresAt > Date.now());
        if (key.startsWith('r:') && live.length) {
          node.value = encodeHydrationValue(
            project(
              decodeHydrationValue(node.value) as RecordValue,
              live.flatMap((claim) => claim.paths),
            ),
          );
        }
        await this.put([[this.nodeKey(key), live.length ? node : undefined]]);
      }
      await this.step();
    }
    await this.put([
      [this.rootKey(rootId), undefined],
      [`${this.prefix}lru:${stamp(root.usedAt)}:${rootId}`, undefined],
      [`${this.prefix}expiry:${stamp(root.fetchedAt + root.maxAge)}:${rootId}`, undefined],
    ]);
  }

  private async save(
    request: RequestDescriptor,
    fetchedAt: number,
    maxAge: number,
    usedAt = Date.now(),
    fromNetwork = false,
  ) {
    if (!maxAge || fetchedAt + maxAge <= Date.now()) {
      await this.remove(request.key);
      return;
    }
    const { nodes } = await this.collect(request, true, fromNetwork);
    const root: Root = {
      fetchedAt,
      maxAge,
      nodes: [...nodes.keys()],
      request: encodeRequests([request]),
      usedAt,
    };
    // Do not evict useful requests to discover that this graph cannot fit even
    // on its own. The estimate includes one claim per node and root metadata.
    let minimum =
      sized(this.rootKey(request.key), root).bytes +
      sized(`${this.prefix}lru:${stamp(usedAt)}:${request.key}`, request.key).bytes +
      sized(`${this.prefix}expiry:${stamp(fetchedAt + maxAge)}:${request.key}`, request.key).bytes +
      sized(`${this.prefix}scope`, this.client.getPersistenceScope()).bytes;
    for (const [key, node] of nodes) {
      minimum += sized(this.nodeKey(key), {
        claims: {
          [request.key]: { expiresAt: fetchedAt + maxAge, fetchedAt, paths: [...node.paths] },
        },
        value: encodeHydrationValue(node.value),
      }).bytes;
      await this.step();
    }
    if (minimum + this.journalBytes + this.overhead > this.maxBytes) {
      await this.remove(request.key);
      return;
    }
    const prepare = async () => {
      const old = await this.read<Root>(this.rootKey(request.key));
      const writes = new Map<string, unknown>();
      if (old) {
        writes.set(`${this.prefix}lru:${stamp(old.usedAt)}:${request.key}`, undefined);
        writes.set(
          `${this.prefix}expiry:${stamp(old.fetchedAt + old.maxAge)}:${request.key}`,
          undefined,
        );
      }
      // The union keeps interrupted batches discoverable by expiry/eviction.
      writes.set(this.rootKey(request.key), {
        ...root,
        nodes: [...new Set([...root.nodes, ...(old?.nodes ?? [])])],
      });
      writes.set(`${this.prefix}lru:${stamp(root.usedAt)}:${request.key}`, request.key);
      writes.set(`${this.prefix}expiry:${stamp(fetchedAt + maxAge)}:${request.key}`, request.key);
      for (const key of new Set([...nodes.keys(), ...(old?.nodes ?? [])])) {
        const previous = await this.node(key);
        const next = nodes.get(key);
        const claims = previous?.claims ?? {};
        if (!next) {
          delete claims[request.key];
        } else {
          claims[request.key] = {
            expiresAt: fetchedAt + maxAge,
            fetchedAt,
            paths: [...next.paths],
          };
        }
        let value = next?.value;
        if (previous && key.startsWith('r:')) {
          const before = decodeHydrationValue(previous.value) as RecordValue;
          const after = next?.value as RecordValue | undefined;
          value = project(
            {
              paths: [...new Set([...before.paths, ...(after?.paths ?? [])])],
              record: { ...before.record, ...after?.record },
            },
            Object.values(claims).flatMap((claim) => claim.paths),
          );
        }
        writes.set(
          this.nodeKey(key),
          Object.keys(claims).length
            ? { claims, value: value !== undefined ? encodeHydrationValue(value) : previous!.value }
            : undefined,
        );
        await this.step();
      }
      return writes;
    };
    let writes = await prepare();
    for (;;) {
      let added = 0;
      for (const [key, value] of writes) {
        const before = (await this.storage.read(key)) as Sized<unknown> | undefined;
        // Reserve all growth before writing, including intermediate metadata.
        added += Math.max(
          0,
          (value === undefined ? 0 : sized(key, value).bytes) - (before?.bytes ?? 0),
        );
        await this.step();
      }
      const used = ((await this.storage.read(`${this.prefix}bytes`)) as number | undefined) ?? 0;
      if (used + added + this.journalBytes + this.overhead <= this.maxBytes) {
        break;
      }
      const candidates = await this.storage.scan(`${this.prefix}lru:`, undefined, 2);
      const candidate = candidates.find(
        (entry) => (entry.value as Sized<string>).value !== request.key,
      );
      if (!candidate) {
        await this.remove(request.key);
        return;
      }
      const id = (candidate.value as Sized<string>).value;
      if (await this.read(this.rootKey(id))) {
        await this.remove(id);
      } else {
        await this.put([[candidate.key, undefined]]);
      }
      writes = await prepare();
    }
    const entries = [...writes];
    for (let index = 0; index < entries.length; index += 64) {
      await this.put(entries.slice(index, index + 64));
      await yieldTask();
    }
    await this.put([[this.rootKey(request.key), root]]);
  }

  /** Called under the shared write lock. Expiry/LRU indexes avoid whole-cache scans. */
  async prune(journalBytes: number) {
    this.journalBytes = journalBytes;
    while (true) {
      const [entry] = await this.storage.scan(`${this.prefix}expiry:`, undefined, 1);
      if (!entry) {
        break;
      }
      const id = (entry.value as Sized<string>).value;
      const root = await this.read<Root>(this.rootKey(id));
      if (root && root.fetchedAt + root.maxAge > Date.now()) {
        break;
      }
      if (root) {
        await this.remove(id);
      } else {
        await this.put([[entry.key, undefined]]);
      }
      await this.step();
    }
    while (
      (((await this.storage.read(`${this.prefix}bytes`)) as number | undefined) ?? 0) +
        journalBytes +
        this.overhead >
      this.maxBytes
    ) {
      const [entry] = await this.storage.scan(`${this.prefix}lru:`, undefined, 1);
      if (!entry) {
        break;
      }
      const id = (entry.value as Sized<string>).value;
      if (await this.read(this.rootKey(id))) {
        await this.remove(id);
      } else {
        await this.put([[entry.key, undefined]]);
      }
      await this.step();
    }
  }

  async fits(journalBytes: number) {
    return (
      (((await this.storage.read(`${this.prefix}bytes`)) as number | undefined) ?? 0) +
        journalBytes +
        this.overhead <=
      this.maxBytes
    );
  }

  async flush(journalBytes: number) {
    if (!(await this.active())) {
      this.reset();
      return;
    }
    await this.prune(journalBytes);
    const pending = this.pending;
    this.pending = new Map();
    const changes = this.changed;
    const fields = this.fields;
    const listBases = this.listBases;
    this.listBases = new Map();
    const recovery = this.recoveryChanges;
    this.recoveryChanges = new Map();
    const updates = new Map(recovery);
    for (const [key, value] of changes) {
      updates.set(
        key,
        mergeCacheUpdate(key, updates.get(key), {
          fields: fields.get(key) ? [...fields.get(key)!] : undefined,
          previousList: listBases.get(key),
          value,
        }),
      );
    }
    this.updates = new Map([...updates].map(([key, update]) => [key, update.value]));
    this.changed = new Map();
    this.updateListBases = new Map([...updates].map(([key, update]) => [key, update.previousList]));
    this.updateFields = new Map(
      [...updates].map(([key, update]) => [
        key,
        update.fields ? new Set(update.fields) : undefined,
      ]),
    );
    this.fields = new Map();
    try {
      const affected = new Map<string, Root>();
      for (const key of this.updates.keys()) {
        const node = await this.node(key);
        const incoming = this.updates.get(key);
        if (node && incoming && key.startsWith('r:')) {
          const before = decodeHydrationValue(node.value) as RecordValue;
          const after = applyRecordUpdate(
            before,
            incoming as RecordValue,
            this.updateFields.get(key),
          );
          const structural = Object.keys({ ...before.record, ...after.record }).some(
            (field) => references(before.record[field]) !== references(after.record[field]),
          );
          if (!structural) {
            const value = encodeHydrationValue(
              project(
                {
                  paths: [...new Set([...before.paths, ...after.paths])],
                  record: { ...before.record, ...after.record },
                },
                Object.values(node.claims).flatMap((claim) => claim.paths),
              ),
            );
            const next = { ...node, value };
            const beforeSize = ((await this.storage.read(this.nodeKey(key))) as Sized<unknown>)
              .bytes;
            const growth = Math.max(0, sized(this.nodeKey(key), next).bytes - beforeSize);
            await this.prune(journalBytes + growth);
            const retained = await this.node(key);
            if (retained) {
              next.claims = retained.claims;
              next.value = encodeHydrationValue(
                project(
                  decodeHydrationValue(value) as RecordValue,
                  Object.values(retained.claims).flatMap((claim) => claim.paths),
                ),
              );
              await this.put([[this.nodeKey(key), next]]);
            }
            this.journalBytes = journalBytes;
            continue;
          }
        }
        for (const rootId of Object.keys(node?.claims ?? {})) {
          if (pending.has(rootId) || affected.has(rootId)) {
            continue;
          }
          const root = await this.read<Root>(this.rootKey(rootId));
          if (root) {
            affected.set(rootId, root);
          }
        }
        await this.step();
      }
      for (const root of affected.values()) {
        await this.save(decodeRequests(root.request)[0], root.fetchedAt, root.maxAge, root.usedAt);
      }
      for (const { fetchedAt, maxAge, request } of pending.values()) {
        if (fetchedAt !== undefined) {
          await this.save(request, fetchedAt, maxAge, Date.now(), true);
        }
      }
      for (const { fetchedAt, maxAge, request } of pending.values()) {
        if (fetchedAt !== undefined) {
          continue;
        }
        if (!maxAge) {
          await this.remove(request.key);
          continue;
        }
        const cached = await this.collect(request, false);
        if (cached.complete && Number.isFinite(cached.fetchedAt)) {
          const root = await this.read<Root>(this.rootKey(request.key));
          // An overlapping selection may have older claims on the same nodes.
          // Reusing this request must preserve its own successful fetch time.
          await this.save(request, root?.fetchedAt ?? cached.fetchedAt, maxAge);
        }
      }
      this.updates.clear();
      await this.prune(journalBytes);
    } catch (error) {
      if (!this.disposed) {
        // Preserve snapshots and their GC retainers so flush can retry after a
        // temporary storage failure, even if the application released its view.
        for (const [key, update] of recovery) {
          this.recoveryChanges.set(
            key,
            this.recoveryChanges.has(key)
              ? mergeCacheUpdate(key, update, this.recoveryChanges.get(key)!)
              : update,
          );
        }
        for (const [key, value] of changes) {
          if (key.startsWith('l:')) {
            this.listBases.set(key, listBases.get(key));
          }
          if (!this.changed.has(key)) {
            this.changed.set(key, value);
            this.fields.set(key, fields.get(key));
          } else if (key.startsWith('r:')) {
            const before = fields.get(key);
            const after = this.fields.get(key);
            this.fields.set(key, before && after ? new Set([...before, ...after]) : undefined);
          }
        }
        for (const [key, entry] of pending) {
          if (!this.pending.has(key)) {
            this.pending.set(key, entry);
            pending.delete(key);
          }
        }
      }
      throw error;
    } finally {
      this.updates.clear();
      this.updateFields.clear();
      this.updateListBases.clear();
      for (const entry of pending.values()) {
        entry.release();
      }
    }
  }

  async clear() {
    this.reset();
    while (true) {
      const entries = await this.storage.scan(this.prefix, undefined, 64);
      if (!entries.length) {
        return;
      }
      await this.storage.writeBatch(entries.map(({ key }) => [key, undefined]));
      await yieldTask();
    }
  }

  dispose() {
    this.disposed = true;
    this.reset();
  }

  private reset() {
    this.recoveryChanges.clear();
    this.policies = new WeakMap();
    for (const entry of this.pending.values()) {
      entry.release();
    }
    this.pending.clear();
    this.changed.clear();
    this.updates.clear();
    this.fields.clear();
    this.updateFields.clear();
    this.listBases.clear();
    this.updateListBases.clear();
  }
}
