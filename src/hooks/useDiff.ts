/**
 * Hook for fetching task diff data.
 *
 * Returns highlighted diff hunks and file metadata.
 * Fetches when the task ID changes and polls every 2 seconds while active.
 */

import { useCallback, useRef, useState } from "react";
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
}

interface UseDiffResult {
  diff: HighlightedTaskDiff | null;
  loading: boolean;
  error: unknown;
}

/**
 * Compute a fingerprint for change detection.
 *
 * Includes hunk boundary content so that edits that preserve line counts
 * (e.g. typo fixes) are still detected as changes.
 */
export function buildDiffFingerprint(files: HighlightedFileDiff[]): string {
  return JSON.stringify(
    files.map((f) => [
      f.path,
      f.additions,
      f.deletions,
      f.hunks.map((h) => [h.lines[0]?.content ?? "", h.lines[h.lines.length - 1]?.content ?? ""]),
    ]),
  );
}

export function useDiff(taskId: string | null, contextLines = 3): UseDiffResult {
  const transport = useTransport();
  const connectionState = useConnectionState();
  const [diff, setDiff] = useState<HighlightedTaskDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fingerprintRef = useRef<string>("");
  // Tracks whether the first fetch has completed to guard the loading state.
  // Using a ref (not state) avoids adding it as a useCallback dependency.
  const hasFetchedOnceRef = useRef(false);

  const fetchDiff = useCallback(async () => {
    if (!taskId) return;

    try {
      // Only show loading spinner on the initial fetch, not on polls.
      if (!hasFetchedOnceRef.current) setLoading(true);
      hasFetchedOnceRef.current = true;
      setError(null);
      const result = await transport.call<HighlightedTaskDiff>("get_task_diff", {
        task_id: taskId,
        context_lines: contextLines,
      });
      // Skip state update when content hasn't changed, preventing re-renders and flash.
      const fingerprint = buildDiffFingerprint(result.files);
      if (fingerprint !== fingerprintRef.current) {
        fingerprintRef.current = fingerprint;
        setDiff(result);
      }
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
