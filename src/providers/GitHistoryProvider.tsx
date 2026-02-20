/**
 * Provider for git commit history and branch info.
 *
 * Fetches commit log and branch data with 2-second polling. File counts are lazy-loaded separately via batch endpoint.
 */

import { invoke } from "@tauri-apps/api/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePolling } from "../hooks/usePolling";
import type { BranchList, CommitInfo, SyncStatus } from "../types/workflow";
import { extractErrorMessage } from "../utils/errors";

interface OperationError {
  type: "push" | "pull";
  message: string;
}

interface SyncControls {
  isDetachedHead: boolean;
  showSyncStatus: boolean;
  canPush: boolean;
  canPull: boolean;
}

interface GitHistoryContextValue extends SyncControls {
  commits: CommitInfo[];
  fileCounts: Map<string, number>;
  currentBranch: string | null;
  branches: string[];
  loading: boolean;
  error: unknown;
  syncStatus: SyncStatus | null;
  operationError: OperationError | null;
  pushLoading: boolean;
  pullLoading: boolean;
  fetchLoading: boolean;
  pushToOrigin: () => Promise<void>;
  pullFromOrigin: () => Promise<void>;
  fetchFromOrigin: () => Promise<void>;
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
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [pushLoading, setPushLoading] = useState(false);
  const [pullLoading, setPullLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [operationError, setOperationError] = useState<OperationError | null>(null);
  const requestedHashesRef = useRef<Set<string>>(new Set());

  const fetchCommits = useCallback(async () => {
    try {
      const [commitResult, branchResult, syncResult] = await Promise.all([
        invoke<CommitInfo[]>("workflow_get_commit_log"),
        invoke<BranchList>("workflow_list_branches"),
        invoke<SyncStatus | null>("workflow_git_sync_status"),
      ]);
      setCommits(commitResult);
      setCurrentBranch(branchResult.current);
      setBranches(branchResult.branches);
      setSyncStatus(syncResult);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const pushToOrigin = useCallback(async () => {
    setPushLoading(true);
    setOperationError(null);
    try {
      await invoke("workflow_git_push");
      const status = await invoke<SyncStatus | null>("workflow_git_sync_status");
      setSyncStatus(status);
    } catch (err) {
      console.error("Push failed:", err);
      setOperationError({ type: "push", message: extractErrorMessage(err) });
    } finally {
      setPushLoading(false);
    }
  }, []);

  const fetchFromOrigin = useCallback(async () => {
    setFetchLoading(true);
    setOperationError(null);
    try {
      await invoke("workflow_git_fetch");
      const status = await invoke<SyncStatus | null>("workflow_git_sync_status");
      setSyncStatus(status);
    } catch (err) {
      console.error("Fetch failed:", err);
      setOperationError({ type: "pull", message: extractErrorMessage(err) });
    } finally {
      setFetchLoading(false);
    }
  }, []);

  const pullFromOrigin = useCallback(async () => {
    setPullLoading(true);
    setOperationError(null);
    try {
      await invoke("workflow_git_pull");
      const [commitResult, status] = await Promise.all([
        invoke<CommitInfo[]>("workflow_get_commit_log"),
        invoke<SyncStatus | null>("workflow_git_sync_status"),
      ]);
      setCommits(commitResult);
      setSyncStatus(status);
    } catch (err) {
      console.error("Pull failed:", err);
      setOperationError({ type: "pull", message: extractErrorMessage(err) });
    } finally {
      setPullLoading(false);
    }
  }, []);

  usePolling(fetchCommits, 2000);

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

  const syncControls = useMemo((): SyncControls => {
    const isDetachedHead = currentBranch === "HEAD";
    const showSyncStatus = syncStatus !== null && !isDetachedHead;
    return {
      isDetachedHead,
      showSyncStatus,
      canPush: showSyncStatus && syncStatus.ahead > 0,
      canPull: showSyncStatus && syncStatus.behind > 0,
    };
  }, [currentBranch, syncStatus]);

  const value: GitHistoryContextValue = {
    commits,
    fileCounts,
    currentBranch,
    branches,
    loading,
    error,
    syncStatus,
    operationError,
    pushLoading,
    pullLoading,
    fetchLoading,
    pushToOrigin,
    pullFromOrigin,
    fetchFromOrigin,
    ...syncControls,
  };

  return <GitHistoryContext.Provider value={value}>{children}</GitHistoryContext.Provider>;
}
