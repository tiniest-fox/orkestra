/**
 * Hook for fetching a single commit's syntax-highlighted diff.
 *
 * Module-level cache: commit hashes are immutable, so results are cached
 * indefinitely. Subsequent accesses to the same hash are instant.
 *
 * Use prefetchCommitDiff() to warm the cache before the drawer opens.
 *
 * Cache key includes contextLines so expanding context triggers a fresh fetch.
 */

import { useEffect, useState } from "react";
import { type Transport, useTransport } from "../transport";
import type { HighlightedTaskDiff } from "./useDiff";

// Module-level cache — commit hashes are immutable, safe to cache indefinitely.
const diffCache = new Map<string, HighlightedTaskDiff>();
const pendingFetches = new Map<string, Promise<HighlightedTaskDiff>>();

/** Pre-warm the diff cache for a commit. No-op if already cached or in-flight. */
export function prefetchCommitDiff(
  commitHash: string,
  transport: Transport,
  contextLines = 3,
): void {
  const cacheKey = `${commitHash}:${contextLines}`;
  if (diffCache.has(cacheKey) || pendingFetches.has(cacheKey)) return;
  const p = transport.call<HighlightedTaskDiff>("get_commit_diff", {
    commit_hash: commitHash,
    context_lines: contextLines,
  });
  pendingFetches.set(cacheKey, p);
  p.then((result) => {
    diffCache.set(cacheKey, result);
    pendingFetches.delete(cacheKey);
  }).catch(() => {
    pendingFetches.delete(cacheKey);
  });
}

interface UseCommitDiffResult {
  diff: HighlightedTaskDiff | null;
  loading: boolean;
  error: unknown;
}

export function useCommitDiff(commitHash: string | null, contextLines = 3): UseCommitDiffResult {
  const cacheKey = commitHash ? `${commitHash}:${contextLines}` : null;
  const transport = useTransport();
  const [diff, setDiff] = useState<HighlightedTaskDiff | null>(() =>
    cacheKey ? (diffCache.get(cacheKey) ?? null) : null,
  );
  const [loading, setLoading] = useState<boolean>(
    () => cacheKey !== null && !diffCache.has(cacheKey),
  );
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!cacheKey || !commitHash) {
      setDiff(null);
      setLoading(false);
      setError(null);
      return;
    }

    // Cache hit — serve immediately, no fetch needed.
    const cached = diffCache.get(cacheKey);
    if (cached) {
      setDiff(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    // Reuse an in-flight promise (e.g. started by prefetchCommitDiff) or
    // start a new one.
    let promise = pendingFetches.get(cacheKey);
    if (!promise) {
      promise = transport.call<HighlightedTaskDiff>("get_commit_diff", {
        commit_hash: commitHash,
        context_lines: contextLines,
      });
      pendingFetches.set(cacheKey, promise);
    }

    promise
      .then((result) => {
        diffCache.set(cacheKey, result);
        pendingFetches.delete(cacheKey);
        if (!cancelled) {
          setDiff(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        pendingFetches.delete(cacheKey);
        if (!cancelled) {
          setError(err);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [transport, cacheKey, commitHash, contextLines]);

  return { diff, loading, error };
}
