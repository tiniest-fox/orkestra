import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { HighlightedTaskDiff } from "./useDiff";

interface UseCommitDiffResult {
  diff: HighlightedTaskDiff | null;
  loading: boolean;
  error: unknown;
}

export function useCommitDiff(commitHash: string | null): UseCommitDiffResult {
  const [diff, setDiff] = useState<HighlightedTaskDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!commitHash) {
      setDiff(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    invoke<HighlightedTaskDiff>("workflow_get_commit_diff", { commitHash })
      .then((result) => {
        if (!cancelled) setDiff(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [commitHash]);

  return { diff, loading, error };
}
