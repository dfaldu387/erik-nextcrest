// A small work queue for bulk inserts: runs up to `concurrency` jobs at once, in the order given.
// Used by the property import, so several 500-row inserts are in flight together instead of one after another.

/** Runs `worker` for every item, with at most `concurrency` running at the same time. Resolves when all have finished. */
export async function runQueue<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
}

/** True for errors that may pass on a retry: timeouts, dropped connections and gateway errors. */
export function isTransientError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '57014' || error.code === '40001') return true; // statement timeout, serialization failure
  return /timeout|timed out|fetch|network|connection|502|503|504|gateway/i.test(error.message ?? '');
}

/** Runs `attempt` again after a short wait, up to `retries` times, while the error is transient. */
export async function withRetry<T extends { error: { code?: string; message?: string } | null }>(
  attempt: () => PromiseLike<T>,
  retries: number,
  baseDelayMs = 500,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let tries = 0; ; tries += 1) {
    const result = await attempt();
    if (!result.error || tries >= retries || !isTransientError(result.error)) return result;
    await wait(baseDelayMs * 2 ** tries);
  }
}
