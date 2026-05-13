import { filterConnectionArgs, hashArgs } from './args.ts';

const encodeTopicPart = (value: string | number): string => encodeURIComponent(String(value));

const normalizeConnectionArgs = (args?: Record<string, unknown>) => {
  const filtered = filterConnectionArgs(args);
  if (!filtered) {
    return undefined;
  }

  const id = filtered.id;
  return typeof id === 'string' || typeof id === 'number'
    ? { ...filtered, id: String(id) }
    : filtered;
};

export const liveEntityTopic = (type: string, id: string | number): string =>
  `entity:${encodeTopicPart(type)}:${encodeTopicPart(id)}`;

export const liveConnectionTopic = (procedure: string, args?: Record<string, unknown>): string =>
  `connection:${encodeTopicPart(procedure)}:${encodeTopicPart(
    hashArgs(normalizeConnectionArgs(args) ?? {}),
  )}`;

export const liveGlobalConnectionTopic = (procedure: string): string =>
  `connection:${encodeTopicPart(procedure)}:*`;
