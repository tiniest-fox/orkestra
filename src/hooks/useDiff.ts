/**
 * Hook for fetching task diff data.
 *
 * Returns highlighted diff hunks and file metadata.
 * Fetches when the task ID changes and polls every 2 seconds while active.
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import { usePolling } from "./usePolling";

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
  error: unknown;
}

export function useDiff(taskId: string | null): UseDiffResult {
  const [diff, setDiff] = useState<HighlightedTaskDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const fetchDiff = useCallback(async () => {
    if (!taskId) return;

    try {
      setLoading(true);
      setError(null);
      const result = await invoke<HighlightedTaskDiff>("workflow_get_task_diff", { taskId });
      setDiff(result);
    } catch (err) {
      console.error("Failed to fetch diff:", err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  usePolling(taskId ? fetchDiff : null, 2000);

  return { diff, loading, error };
}
