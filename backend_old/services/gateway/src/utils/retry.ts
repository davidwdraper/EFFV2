// backend/services/gateway/src/utils/retry.ts
export type RetryOptions = {
  attempts: number; // total tries incl. first
  baseMs: number; // base backoff
  maxMs: number; // max backoff
  jitter?: boolean; // add randomness
  isIdempotent?: boolean; // guard; only retry idempotent
};

export async function retry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions
): Promise<T> {
  if (!opts.isIdempotent) return fn();
  let tries = 0;
  let delay = opts.baseMs;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (e) {
      tries += 1;
      if (tries >= opts.attempts) throw e;
      const jitter = opts.jitter ? Math.random() : 1;
      const sleep = Math.min(opts.maxMs, Math.floor(delay * (1.5 + jitter)));
      await new Promise((r) => setTimeout(r, sleep));
      delay = sleep;
    }
  }
}
