/**
 * A foundation-level guard against credential-stuffing/brute-force on
 * login and register — an in-memory sliding window, not a distributed
 * limiter. That's a deliberate Layer 2B scope choice (see docs §13): this
 * is one process with no deployment yet, so Redis/etc. would be
 * infrastructure this stage doesn't need. Swap for a shared store when
 * this API actually runs more than one instance.
 */

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** true = allowed (and the attempt is recorded), false = over the limit. */
  attempt(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
