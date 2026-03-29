// Hook and utility for tracking whether cached data has gone stale.

import { useEffect, useState } from "react";

const STALE_THRESHOLD_MS = 5_000;

/**
 * Returns `true` once `lastFetchedAt` is older than `thresholdMs`.
 * Resets to `false` whenever `lastFetchedAt` changes (i.e., new data arrived).
 */
export function useStalenessTimer(
  lastFetchedAt: number,
  thresholdMs: number = STALE_THRESHOLD_MS,
): boolean {
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    setIsStale(false);
    const elapsed = Date.now() - lastFetchedAt;
    const remaining = Math.max(0, thresholdMs - elapsed);
    const timer = setTimeout(() => setIsStale(true), remaining);
    return () => clearTimeout(timer);
  }, [lastFetchedAt, thresholdMs]);

  return isStale;
}

/** Tailwind opacity classes for a stale content container. */
export function stalenessClass(isStale: boolean): string {
  return `${isStale ? "opacity-60" : "opacity-100"} transition-opacity duration-300`;
}
