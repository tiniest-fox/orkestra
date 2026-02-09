/**
 * Hook for fetching task diff data.
 *
 * Returns highlighted diff hunks and file metadata.
 * Fetches when the task ID changes and polls every 2 seconds while active.
 */

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export interface HighlightedLine {
  line_type: "add" | "delete" | "context";
  content: string;
  html: string;
  old_line_number: number | null;
  new_line_number: number | null;
}

export interface HighlightedHunk {
  old_start: number;
  old_count: number;
  new_start: number;
  new_count: number;
  lines: HighlightedLine[];
}

export interface HighlightedFileDiff {
  path: string;
  change_type: "added" | "modified" | "deleted" | "renamed";
  old_path: string | null;
  additions: number;
  deletions: number;
  is_binary: boolean;
  hunks: HighlightedHunk[];
}

export interface HighlightedTaskDiff {
  files: HighlightedFileDiff[];
}

interface UseDiffResult {
  diff: HighlightedTaskDiff | null;
  loading: boolean;
  error: string | null;
}

export function useDiff(taskId: string | null): UseDiffResult {
  const [diff, setDiff] = useState<HighlightedTaskDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) {
      setDiff(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const fetchDiff = async () => {
      if (cancelled) return;

      try {
        setLoading(true);
        setError(null);
        const result = await invoke<HighlightedTaskDiff>("workflow_get_task_diff", { taskId });
        if (!cancelled) {
          setDiff(result);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to fetch diff:", err);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchDiff();

    const intervalId = setInterval(fetchDiff, 2000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [taskId]);

  return { diff, loading, error };
}
