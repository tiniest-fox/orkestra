/**
 * Hook for fetching a single commit's syntax-highlighted diff.
 *
 * Module-level cache: commit hashes are immutable, so results are cached
 * indefinitely. Subsequent accesses to the same hash are instant.
 *
 * Use prefetchCommitDiff() to warm the cache before the drawer opens.
 */

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { HighlightedTaskDiff } from "./useDiff";

// Module-level cache — commit hashes are immutable, safe to cache indefinitely.
const diffCache = new Map<string, HighlightedTaskDiff>();
const pendingFetches = new Map<string, Promise<HighlightedTaskDiff>>();

/** Pre-warm the diff cache for a commit. No-op if already cached or in-flight. */
export function prefetchCommitDiff(commitHash: string): void {
  if (diffCache.has(commitHash) || pendingFetches.has(commitHash)) return;
  const p = invoke<HighlightedTaskDiff>("workflow_get_commit_diff", { commitHash });
  pendingFetches.set(commitHash, p);
  p.then((result) => {
    diffCache.set(commitHash, result);
    pendingFetches.delete(commitHash);
  }).catch(() => {
    pendingFetches.delete(commitHash);
  });
}

interface UseCommitDiffResult {
  diff: HighlightedTaskDiff | null;
  loading: boolean;
  error: unknown;
}

export function useCommitDiff(commitHash: string | null): UseCommitDiffResult {
  const [diff, setDiff] = useState<HighlightedTaskDiff | null>(
    () => (commitHash ? (diffCache.get(commitHash) ?? null) : null),
  );
  const [loading, setLoading] = useState<boolean>(
    () => commitHash !== null && !diffCache.has(commitHash),
  );
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!commitHash) {
      setDiff(null);
      setLoading(false);
      setError(null);
      return;
    }

    // Cache hit — serve immediately, no fetch needed.
    const cached = diffCache.get(commitHash);
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
    let promise = pendingFetches.get(commitHash);
    if (!promise) {
      promise = invoke<HighlightedTaskDiff>("workflow_get_commit_diff", { commitHash });
      pendingFetches.set(commitHash, promise);
    }

    promise
      .then((result) => {
        diffCache.set(commitHash, result);
        pendingFetches.delete(commitHash);
        if (!cancelled) {
          setDiff(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        pendingFetches.delete(commitHash);
        if (!cancelled) {
          setError(err);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [commitHash]);

  return { diff, loading, error };
}
