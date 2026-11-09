import type { ClientStateSnapshot } from './client-persistence.ts';
import { resolveHydrationLimits, type HydrationLimits } from './hydration.ts';
import { isRecord } from './record.ts';
import { parseEntityId } from './ref.ts';
import { getListKey, parseListKey } from './store.ts';
import type { AnyRecord } from './types.ts';

export type ClientStateMigration = (state: ClientStateMigrationState) => void;

export interface ClientStateMigrationState {
  /** Replace saved fields on each record of this type. The record's identity must stay the same. */
  mapRecords(type: string, map: (record: Readonly<AnyRecord>, id: string) => AnyRecord): void;
  /** Rename a stored field, including its list membership and argument variants. */
  renameField(type: string, from: string, to: string): void;
}

export type ClientStatePersistenceOptions = Readonly<{
  /** Previous hydration scope when importing an existing scope-keyed client graph. */
  legacyScope?: string;
  /** Serialization limits for each saved entry. */
  limits?: Partial<HydrationLimits>;
  /** Separate budget for saved client state. Defaults to the persistence maxBytes. */
  maxBytes?: number;
  /** Each migration upgrades from the preceding version to the indicated version. */
  migrations?: Readonly<Partial<Record<number, ClientStateMigration>>>;
  /** Application schema version. Defaults to 1. */
  version?: number;
}>;

const validVersion = (version: number) => Number.isSafeInteger(version) && version > 0;

export function resolveClientStateOptions(
  options: ClientStatePersistenceOptions | undefined,
  defaultMaxBytes: number,
) {
  const {
    legacyScope,
    limits,
    maxBytes = defaultMaxBytes,
    migrations = {},
    version = 1,
  } = options ?? {};
  if (!validVersion(version)) {
    throw new Error('fate: Client state version must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('fate: Client state maxBytes must be a positive safe integer.');
  }
  const steps = new Map<number, ClientStateMigration>();
  for (const [key, step] of Object.entries(migrations)) {
    const target = Number(key);
    if (!validVersion(target) || target < 2 || target > version || typeof step !== 'function') {
      throw new Error(`fate: Invalid client state migration '${key}'.`);
    }
    steps.set(target, step);
  }
  return { legacyScope, limits: resolveHydrationLimits(limits), maxBytes, steps, version };
}

export function migrateClientState(
  state: ClientStateSnapshot,
  fromVersion: number,
  { steps, version }: ReturnType<typeof resolveClientStateOptions>,
) {
  const mapRecords: ClientStateMigrationState['mapRecords'] = (type, map) => {
    for (const [key, record] of state.records) {
      const { id, type: recordType } = parseEntityId(key);
      if (record && type === recordType) {
        const next = map(Object.freeze({ ...record }), id);
        if (!isRecord(next) || next.id !== record.id || next.__typename !== record.__typename) {
          throw new Error(`fate: Client state migration changed the identity of '${key}'.`);
        }
        state.records.set(key, next);
      }
    }
  };
  const context: ClientStateMigrationState = {
    mapRecords,
    renameField(type, from, to) {
      if (from === to) {
        return;
      }
      if (
        [from, to].some(
          (field) => !/^[_a-zA-Z]\w*$/.test(field) || field === 'id' || field === '__typename',
        )
      ) {
        throw new Error('fate: A client state migration must rename a stored field.');
      }
      mapRecords(type, (record) =>
        Object.fromEntries(
          Object.entries(record).map(([key, value]) => {
            if (key.split('(', 1)[0] !== from) {
              return [key, value];
            }
            const next = to + key.slice(from.length);
            if (Object.hasOwn(record, next)) {
              throw new Error(`fate: Client state migration would overwrite '${type}.${next}'.`);
            }
            return [next, value];
          }),
        ),
      );
      for (const [key, list] of state.lists) {
        const owner = parseListKey(key);
        if (owner?.field === from && parseEntityId(owner.ownerId).type === type) {
          const next = getListKey(owner.ownerId, to, owner.hash);
          if (state.lists.has(next)) {
            throw new Error(`fate: Client state migration would overwrite '${type}.${to}'.`);
          }
          state.lists.delete(key);
          state.lists.set(next, list);
        }
      }
    },
  };
  for (let target = fromVersion + 1; target <= version; target++) {
    const step = steps.get(target);
    if (!step) {
      throw new Error(`fate: Missing client state migration to version ${target}.`);
    }
    const result: unknown = step(context);
    if (isRecord(result) && typeof result.then === 'function') {
      void Promise.resolve(result).catch(() => {});
      throw new Error('fate: Client state migrations must be synchronous.');
    }
  }
}
