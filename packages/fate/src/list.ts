import type { List } from './store.ts';
import type { EntityId } from './types.ts';

export type ListEntry = Readonly<{ cursor?: string; id: EntityId }>;

export const getListEntries = (listState: List | undefined): Array<ListEntry> => {
  if (!listState) {
    return [];
  }

  const entries: Array<ListEntry> = [];

  for (const id of listState.pendingBeforeIds ?? []) {
    entries.push({ id });
  }

  listState.ids.forEach((id, index) => {
    entries.push({ cursor: listState.cursors?.[index], id });
  });

  for (const id of listState.pendingAfterIds ?? []) {
    entries.push({ id });
  }

  return entries;
};
