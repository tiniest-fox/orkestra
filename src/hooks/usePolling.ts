/**
 * Sequential polling hook.
 *
 * Waits for the async function to complete before scheduling the next run.
 * Never overlaps. Pass null to disable polling.
 */

import { useCallback, useEffect, useRef } from "react";

/**
 * Run an async function sequentially: wait for it to complete, then schedule
 * the next run after `intervalMs`. Never overlaps.
 *
 * Pass `null` as `fn` to disable polling (e.g. when a condition isn't met).
 * Returns `reset()` to cancel any pending timer and immediately start a new
 * poll cycle (used by TasksProvider to react to Tauri events).
 *
 * `fn` must be stable (wrap in useCallback).
 */
export function usePolling(
  fn: (() => Promise<void>) | null,
  intervalMs: number,
): { reset: () => void } {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const cancelRef = useRef<(() => void) | null>(null);

  const start = useCallback(() => {
    // Cancel any pending timer
    cancelRef.current?.();

    let timerId: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const run = async () => {
      if (stopped || !fnRef.current) return;
      await fnRef.current();
      if (!stopped) {
        timerId = setTimeout(run, intervalMs);
      }
    };

    run();

    cancelRef.current = () => {
      stopped = true;
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [intervalMs]);

  useEffect(() => {
    if (!fn) return;
    start();
    return () => cancelRef.current?.();
  }, [fn, start]); // re-starts when fn goes null→fn or fn→null

  return { reset: start };
}
