/**
 * Provider for git commit history.
 *
 * Fetches commit log with 2-second polling. File counts are lazy-loaded separately via batch endpoint.
 */

import { invoke } from "@tauri-apps/api/core";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import type { CommitInfo } from "../types/workflow";

interface GitHistoryContextValue {
  commits: CommitInfo[];
  fileCounts: Map<string, number>;
  loading: boolean;
  error: string | null;
}

const GitHistoryContext = createContext<GitHistoryContextValue | null>(null);

/**
 * Access git commit history. Must be used within GitHistoryProvider.
 */
export function useGitHistory(): GitHistoryContextValue {
  const ctx = useContext(GitHistoryContext);
  if (!ctx) {
    throw new Error("useGitHistory must be used within GitHistoryProvider");
  }
  return ctx;
}

interface GitHistoryProviderProps {
  children: ReactNode;
}

export function GitHistoryProvider({ children }: GitHistoryProviderProps) {
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [fileCounts, setFileCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCommits = useCallback(async () => {
    try {
      const result = await invoke<CommitInfo[]>("workflow_get_commit_log");
      setCommits(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCommits();
    const interval = setInterval(fetchCommits, 2000);
    return () => clearInterval(interval);
  }, [fetchCommits]);

  useEffect(() => {
    if (commits.length === 0) return;

    // Find hashes we don't have counts for yet
    const missing = commits.map((c) => c.hash).filter((hash) => !fileCounts.has(hash));

    if (missing.length === 0) return;

    let cancelled = false;

    invoke<Record<string, number>>("workflow_get_batch_file_counts", { hashes: missing })
      .then((result) => {
        if (cancelled) return;
        setFileCounts((prev) => {
          const next = new Map(prev);
          for (const [hash, count] of Object.entries(result)) {
            next.set(hash, count);
          }
          return next;
        });
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Failed to fetch file counts:", err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [commits, fileCounts]);

  const value: GitHistoryContextValue = {
    commits,
    fileCounts,
    loading,
    error,
  };

  return <GitHistoryContext.Provider value={value}>{children}</GitHistoryContext.Provider>;
}
