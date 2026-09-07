/** Runs `worker` over `items` with at most `limit` in flight at once (spec section 30). */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runNext(): Promise<void> {
    const index = cursor++;
    if (index >= items.length) return;
    results[index] = await worker(items[index], index);
    await runNext();
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}

/** Like mapWithConcurrency but never throws — collects per-item success/failure (spec section 8: one failure must not hide others). */
export async function settleWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<Array<{ item: T; result?: R; error?: Error }>> {
  return mapWithConcurrency(items, limit, async (item, index) => {
    try {
      const result = await worker(item, index);
      return { item, result };
    } catch (error) {
      return { item, error: error instanceof Error ? error : new Error(String(error)) };
    }
  });
}
