/**
 * Hook for fetching task diff data.
 *
 * Returns highlighted diff hunks and file metadata.
 * Fetches when the task ID changes and polls every 2 seconds while active.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnectionState, useTransport } from "../transport";
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
  total_new_lines?: number | null;
}

export interface HighlightedTaskDiff {
  files: HighlightedFileDiff[];
  diff_sha?: string;
}

interface DiffUnchangedResponse {
  unchanged: true;
  diff_sha: string;
}

type DiffResponse = HighlightedTaskDiff | DiffUnchangedResponse;

interface UseDiffResult {
  diff: HighlightedTaskDiff | null;
  loading: boolean;
  error: unknown;
}

export function useDiff(taskId: string | null, contextLines = 3): UseDiffResult {
  const transport = useTransport();
  const connectionState = useConnectionState();
  const [diff, setDiff] = useState<HighlightedTaskDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const diffShaRef = useRef<string | null>(null);
  // Tracks whether the first fetch has completed to guard the loading state.
  // Using a ref (not state) avoids adding it as a useCallback dependency.
  const hasFetchedOnceRef = useRef(false);

  // Reset when task changes to avoid sending a stale last_sha for a different task.
  // biome-ignore lint/correctness/useExhaustiveDependencies: taskId is intentional — effect fires on task change to reset the ref
  useEffect(() => {
    diffShaRef.current = null;
  }, [taskId]);

  const fetchDiff = useCallback(async () => {
    if (!taskId) return;

    try {
      // Only show loading spinner on the initial fetch, not on polls.
      if (!hasFetchedOnceRef.current) setLoading(true);
      hasFetchedOnceRef.current = true;
      setError(null);
      const result = await transport.call<DiffResponse>("get_task_diff", {
        task_id: taskId,
        context_lines: contextLines,
        ...(diffShaRef.current ? { last_sha: diffShaRef.current } : {}),
      });

      if ("unchanged" in result && result.unchanged) {
        // Backend confirmed nothing changed — keep existing diff state.
        return;
      }

      // Full diff response — update state and store fingerprint.
      const fullResult = result as HighlightedTaskDiff;
      diffShaRef.current = fullResult.diff_sha ?? null;
      setDiff(fullResult);
    } catch (err) {
      console.error("Failed to fetch diff:", err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [transport, taskId, contextLines]);

  usePolling(taskId && connectionState === "connected" ? fetchDiff : null, 2000);

  return { diff, loading, error };
}
