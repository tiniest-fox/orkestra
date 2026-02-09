/**
 * Provider for git commit history.
 *
 * Eagerly fetches commit log on app startup and polls every 2s.
 */

import { invoke } from "@tauri-apps/api/core";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import type { CommitInfo } from "../types/workflow";

interface GitHistoryContextValue {
  commits: CommitInfo[];
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

    return () => {
      clearInterval(interval);
    };
  }, [fetchCommits]);

  const value: GitHistoryContextValue = {
    commits,
    loading,
    error,
  };

  return <GitHistoryContext.Provider value={value}>{children}</GitHistoryContext.Provider>;
}
