import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit';

describe('RateLimiter', () => {
  it('allows up to the max attempts within the window, then blocks', () => {
    const limiter = new RateLimiter(3, 1000);
    const now = 1_000_000;
    expect(limiter.attempt('key', now)).toBe(true);
    expect(limiter.attempt('key', now)).toBe(true);
    expect(limiter.attempt('key', now)).toBe(true);
    expect(limiter.attempt('key', now)).toBe(false);
  });

  it('tracks separate keys independently', () => {
    const limiter = new RateLimiter(1, 1000);
    const now = 1_000_000;
    expect(limiter.attempt('a', now)).toBe(true);
    expect(limiter.attempt('b', now)).toBe(true);
    expect(limiter.attempt('a', now)).toBe(false);
    expect(limiter.attempt('b', now)).toBe(false);
  });

  it('allows attempts again once the window has slid past', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.attempt('key', 1_000_000)).toBe(true);
    expect(limiter.attempt('key', 1_000_500)).toBe(false);
    expect(limiter.attempt('key', 1_002_001)).toBe(true);
  });
});
