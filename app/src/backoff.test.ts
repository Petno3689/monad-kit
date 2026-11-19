import { describe, expect, it } from 'vitest';
import { createBackoff } from './backoff';

describe('createBackoff', () => {
  it('cools down for 30 s and stops after the third failure in a row by default', () => {
    const backoff = createBackoff();
    expect(backoff.failure(100)).toEqual({ blockedUntil: 30_100, stopped: false });
    expect(backoff.failure(200)).toEqual({ blockedUntil: 30_200, stopped: false });
    expect(backoff.failure(300)).toEqual({ blockedUntil: 30_300, stopped: true });
  });

  it('honours its options', () => {
    const backoff = createBackoff({ cooldownMs: 5, maxFailures: 1 });
    expect(backoff.failure(10)).toEqual({ blockedUntil: 15, stopped: true });
  });

  it('counts only consecutive failures', () => {
    const backoff = createBackoff();
    backoff.failure(0);
    backoff.failure(0);
    backoff.success();
    expect(backoff.failure(0).stopped).toBe(false);
    expect(backoff.failure(0).stopped).toBe(false);
    expect(backoff.failure(0).stopped).toBe(true);
  });

  it('stays stopped through a success, until reset', () => {
    const backoff = createBackoff({ maxFailures: 2 });
    backoff.failure(0);
    backoff.failure(0);
    backoff.success();
    expect(backoff.failure(0).stopped).toBe(true);
    backoff.reset();
    expect(backoff.failure(0).stopped).toBe(false);
  });
});
