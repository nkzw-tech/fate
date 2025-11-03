import type {
  FateRecord,
  MutationIdentifier,
  MutationInput,
  MutationResult,
  Snapshot,
} from '@nkzw/fate';
import { useCallback, useState } from 'react';
import { useFateClient } from './context.tsx';

type MutationOptions<Identifier extends MutationIdentifier<any, any, any>> = {
  input: MutationInput<Identifier>;
  optimisticUpdate?: Partial<MutationResult<Identifier>>;
};

function collectSelectedPaths(value: FateRecord): Set<string> {
  const paths = new Set<string>();

  const walk = (current: unknown, prefix: string | null) => {
    if (!current || typeof current !== 'object') {
      if (prefix) {
        paths.add(prefix);
      }
      return;
    }

    if (Array.isArray(current)) {
      if (prefix) {
        paths.add(prefix);
      }
      return;
    }

    for (const [key, child] of Object.entries(current as FateRecord)) {
      const next = prefix ? `${prefix}.${key}` : key;
      paths.add(next);
      walk(child, next);
    }
  };

  walk(value, null);
  return paths;
}

export function useMutation<
  Identifier extends MutationIdentifier<any, any, any>,
>(
  identifier: Identifier,
): readonly [
  (options: MutationOptions<Identifier>) => Promise<MutationResult<Identifier>>,
  boolean,
  unknown,
] {
  const client = useFateClient();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const mutate = useCallback(
    async ({ input, optimisticUpdate }: MutationOptions<Identifier>) => {
      setIsPending(true);
      setError(null);

      const snapshots = new Map<string, Snapshot>();

      if (optimisticUpdate) {
        const update = { ...input, ...optimisticUpdate };
        const select = collectSelectedPaths(update);
        client.write(
          identifier.entity,
          update,
          select.size > 0 ? select : undefined,
          snapshots,
        );
      }

      try {
        const result = (await client.executeMutation(
          identifier.key,
          input,
        )) as MutationResult<Identifier>;

        if (result && typeof result === 'object') {
          const select = collectSelectedPaths(result);
          client.write(
            identifier.entity,
            result,
            select.size > 0 ? select : undefined,
          );
        }

        setIsPending(false);
        return result;
      } catch (error) {
        if (snapshots.size > 0) {
          for (const [id, snapshot] of snapshots) {
            client.restore(id, snapshot);
          }
        }

        setIsPending(false);
        const failure =
          error instanceof Error
            ? error
            : new Error(`fate: Mutation '${identifier.key}' failed.`);
        setError(failure);
        throw failure;
      }
    },
    [client, identifier],
  );

  return [mutate, isPending, error] as const;
}
