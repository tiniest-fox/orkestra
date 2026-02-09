/**
 * Provider for git commit history.
 *
 * Fetches commit log with 2-second polling. File counts are lazy-loaded separately via batch endpoint.
 */

import { invoke } from "@tauri-apps/api/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
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
  const requestedHashesRef = useRef<Set<string>>(new Set());

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

    const missing = commits
      .map((c) => c.hash)
      .filter((hash) => !requestedHashesRef.current.has(hash));

    if (missing.length === 0) return;

    // Mark as in-flight before async call
    for (const h of missing) requestedHashesRef.current.add(h);

    invoke<Record<string, number>>("workflow_get_batch_file_counts", { hashes: missing })
      .then((result) => {
        setFileCounts((prev) => {
          const next = new Map(prev);
          for (const [hash, count] of Object.entries(result)) {
            next.set(hash, count);
          }
          return next;
        });
      })
      .catch((err) => {
        console.error("Failed to fetch file counts:", err);
        // Remove failed hashes so they can be retried on next poll
        for (const h of missing) requestedHashesRef.current.delete(h);
      });
  }, [commits]);

  const value: GitHistoryContextValue = {
    commits,
    fileCounts,
    loading,
    error,
  };

  return <GitHistoryContext.Provider value={value}>{children}</GitHistoryContext.Provider>;
}
