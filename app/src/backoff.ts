export interface BackoffOptions {
  cooldownMs?: number;
  maxFailures?: number;
}

export interface Backoff {
  success: () => void;
  failure: (now: number) => { blockedUntil: number; stopped: boolean };
  reset: () => void;
}

/** Spaces out retries after a failure; `maxFailures` in a row stop them until `reset()`. */
export function createBackoff({ cooldownMs = 30_000, maxFailures = 3 }: BackoffOptions = {}): Backoff {
  let failures = 0;
  let stopped = false;

  return {
    success() {
      failures = 0;
    },
    failure(now) {
      failures += 1;
      if (failures >= maxFailures) stopped = true;
      return { blockedUntil: now + cooldownMs, stopped };
    },
    reset() {
      failures = 0;
      stopped = false;
    },
  };
}
