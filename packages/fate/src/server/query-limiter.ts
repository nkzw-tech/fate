export type RunQuery = <T>(query: () => T | PromiseLike<T>) => Promise<T>;

/** Share a query budget across sibling relations and their recursive hydration. */
export const createQueryLimiter = (limit: number): RunQuery => {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async (query) => {
    if (active < limit) {
      active++;
    } else {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    try {
      return await query();
    } finally {
      const next = waiting.shift();
      if (next) {
        next();
      } else {
        active--;
      }
    }
  };
};

export const runQuery: RunQuery = async (query) => query();
