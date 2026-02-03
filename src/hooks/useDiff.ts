/**
 * Hook for fetching and managing git diff data.
 *
 * Polls diff data from the backend and manages file selection state.
 * Memoizes diff data to prevent unnecessary re-renders.
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// =============================================================================
// Types (matching Rust types from diff.rs)
// =============================================================================

export type FileChangeType = "added" | "modified" | "deleted" | "renamed";

export interface HighlightedLine {
  line_type: "add" | "delete" | "context";
  old_line_number: number | null;
  new_line_number: number | null;
  html: string;
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
  change_type: FileChangeType;
  old_path: string | null;
  additions: number;
  deletions: number;
  is_binary: boolean;
  hunks: HighlightedHunk[] | null;
}

export interface HighlightedTaskDiff {
  files: HighlightedFileDiff[];
}

// =============================================================================
// Hook
// =============================================================================

interface UseDiffResult {
  /** All changed files in the diff. */
  files: HighlightedFileDiff[];
  /** Currently selected file. */
  selectedFile: HighlightedFileDiff | null;
  /** Select a file by path. */
  selectFile: (path: string) => void;
  /** Whether diff data is loading. */
  loading: boolean;
  /** Error message if fetch failed. */
  error: string | null;
}

/**
 * Fetch and manage git diff data for a task.
 *
 * Polls every 2s when active, preserves selected file across refreshes.
 * Memoizes diff data to prevent re-renders when unchanged.
 */
export function useDiff(taskId: string, isActive: boolean): UseDiffResult {
  const [files, setFiles] = useState<HighlightedFileDiff[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track selected path in ref for race condition protection
  const selectedFilePathRef = useRef(selectedFilePath);
  selectedFilePathRef.current = selectedFilePath;

  // Memoize diff metadata for change detection (excluding expensive HTML content)
  const diffFingerprint = useMemo(() => {
    return files.map((f) => ({
      path: f.path,
      change_type: f.change_type,
      additions: f.additions,
      deletions: f.deletions,
    }));
  }, [files]);

  const fetchDiff = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await invoke<HighlightedTaskDiff>("workflow_get_task_diff", { taskId });

      // Compute fingerprint of new data
      const newFingerprint = result.files.map((f) => ({
        path: f.path,
        change_type: f.change_type,
        additions: f.additions,
        deletions: f.deletions,
      }));

      // Only update state if data changed
      const dataChanged =
        JSON.stringify(diffFingerprint) !== JSON.stringify(newFingerprint);

      if (dataChanged) {
        setFiles(result.files);

        // Auto-select first file on initial load or if selected file is gone
        if (selectedFilePathRef.current === null) {
          // Initial load — auto-select first file
          if (result.files.length > 0) {
            setSelectedFilePath(result.files[0].path);
          }
        } else {
          // Refresh — preserve selection if file still exists
          const stillExists = result.files.some(
            (f) => f.path === selectedFilePathRef.current,
          );
          if (!stillExists) {
            // Selected file disappeared, select first file
            setSelectedFilePath(result.files.length > 0 ? result.files[0].path : null);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch diff:", err);
      setError("Failed to load diff data");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [taskId, diffFingerprint]);

  // Fetch on mount and poll when active
  useEffect(() => {
    if (!isActive) {
      return undefined;
    }

    fetchDiff();

    const interval = setInterval(fetchDiff, 2000);
    return () => clearInterval(interval);
  }, [isActive, fetchDiff]);

  const selectedFile = useMemo(() => {
    if (selectedFilePath === null) return null;
    return files.find((f) => f.path === selectedFilePath) || null;
  }, [files, selectedFilePath]);

  const selectFile = useCallback((path: string) => {
    setSelectedFilePath(path);
  }, []);

  return {
    files,
    selectedFile,
    selectFile,
    loading,
    error,
  };
}
