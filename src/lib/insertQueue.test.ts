import { describe, expect, it } from 'vitest';
import { isTransientError, runQueue, withRetry } from '@/lib/insertQueue';

describe('runQueue', () => {
  it('runs every item once, with no more than the limit in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await runQueue([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(item);
      inFlight -= 1;
    });
    expect(peak).toBe(3);
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('does nothing for an empty queue', async () => {
    let called = false;
    await runQueue([], 4, async () => {
      called = true;
    });
    expect(called).toBe(false);
  });
});

describe('isTransientError', () => {
  it('treats timeouts and gateway errors as retryable', () => {
    expect(isTransientError({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(true);
    expect(isTransientError({ message: 'upstream returned 503' })).toBe(true);
  });

  it('does not retry validation or constraint errors', () => {
    expect(isTransientError({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });
});

describe('withRetry', () => {
  it('retries a transient error and then succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        return calls < 3 ? { error: { message: 'statement timeout' } } : { error: null };
      },
      2,
      1,
      async () => undefined,
    );
    expect(calls).toBe(3);
    expect(result.error).toBeNull();
  });

  it('stops at once on a non-transient error', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        return { error: { code: '23505', message: 'duplicate key' } };
      },
      3,
      1,
      async () => undefined,
    );
    expect(calls).toBe(1);
    expect(result.error?.code).toBe('23505');
  });
});
