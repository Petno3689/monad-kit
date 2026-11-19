import { useCallback, useEffect, useState } from 'react';

const RETRY_MS = 10_000;

/**
 * Calls `load` now and then again after every `every` ms (a number, or a function of the last
 * value: it picks the next delay), one call at a time. Pass a memoized `load` and a stable
 * `every`: a new identity restarts the loop. `value` is undefined until the first result for
 * the CURRENT `load`, so a result for an earlier key or chest is never shown. A failed call
 * keeps the last value and retries.
 */
export function usePoll<T>(load: (() => Promise<T>) | null, every: number | ((value: T) => number)) {
  const [state, setState] = useState<{ source: unknown; value: T } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!load) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let delay = typeof every === 'number' ? every : RETRY_MS;
      try {
        const value = await load();
        if (cancelled) return;
        setState({ source: load, value });
        if (typeof every === 'function') delay = every(value);
      } catch {
        // keep the last value and try again
      }
      if (!cancelled) timer = setTimeout(tick, delay);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load, every, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { value: state !== null && state.source === load ? state.value : undefined, refresh };
}

/** The current unix time in seconds, updated every second. */
export function useNowSec(): bigint {
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => {
    const id = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
