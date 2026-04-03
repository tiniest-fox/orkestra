/**
 * Provider for git commit history and branch info.
 *
 * Fetches commit log and branch data with 2-second polling. File counts are lazy-loaded separately via batch endpoint.
 */

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
import { prefetchCommitDiff } from "../hooks/useCommitDiff";
import { usePageVisibility } from "../hooks/usePageVisibility";
import { usePolling } from "../hooks/usePolling";
import { useStalenessTimer } from "../hooks/useStalenessTimer";
import { useConnectionState, useTransport } from "../transport";
import type { BranchList, CommitInfo, SyncStatus } from "../types/workflow";
import { extractErrorMessage } from "../utils/errors";
import { isDisconnectError } from "../utils/transportErrors";

interface GitCache {
  commits: CommitInfo[];
  currentBranch: string | null;
  branches: string[];
  syncStatus: SyncStatus | null;
}
const gitCacheMap = new Map<string, GitCache>();

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
  isStale: boolean; // true when cached data is older than 5s
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
  const transport = useTransport();
  const projectUrl = window.location.href;
  const cached = gitCacheMap.get(projectUrl) ?? null;
  const [commits, setCommits] = useState<CommitInfo[]>(() => cached?.commits ?? []);
  const [fileCounts, setFileCounts] = useState<Map<string, number>>(new Map());
  const [currentBranch, setCurrentBranch] = useState<string | null>(
    () => cached?.currentBranch ?? null,
  );
  const [branches, setBranches] = useState<string[]>(() => cached?.branches ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<unknown>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number>(Date.now());
  const isStale = useStalenessTimer(lastFetchedAt);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(() => cached?.syncStatus ?? null);
  const [pushLoading, setPushLoading] = useState(false);
  const [pullLoading, setPullLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [operationError, setOperationError] = useState<OperationError | null>(null);
  const requestedHashesRef = useRef<Set<string>>(new Set());

  const fetchCommits = useCallback(async () => {
    try {
      const [commitResult, branchResult, syncResult] = await Promise.all([
        transport.call<CommitInfo[]>("get_commit_log"),
        transport.call<BranchList>("list_branches"),
        transport.call<SyncStatus | null>("git_sync_status"),
      ]);
      setCommits(commitResult);
      setCurrentBranch(branchResult.current);
      setBranches(branchResult.branches);
      setSyncStatus(syncResult);
      gitCacheMap.set(projectUrl, {
        commits: commitResult,
        currentBranch: branchResult.current,
        branches: branchResult.branches,
        syncStatus: syncResult,
      });
      setLastFetchedAt(Date.now());
      setError(null);
    } catch (err) {
      if (!isDisconnectError(err)) {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  }, [transport, projectUrl]);

  const pushToOrigin = useCallback(async () => {
    setPushLoading(true);
    setOperationError(null);
    try {
      await transport.call("git_push");
      const status = await transport.call<SyncStatus | null>("git_sync_status");
      setSyncStatus(status);
    } catch (err) {
      console.error("Push failed:", err);
      setOperationError({ type: "push", message: extractErrorMessage(err) });
    } finally {
      setPushLoading(false);
    }
  }, [transport]);

  const fetchFromOrigin = useCallback(async () => {
    setFetchLoading(true);
    setOperationError(null);
    try {
      await transport.call("git_fetch");
      const status = await transport.call<SyncStatus | null>("git_sync_status");
      setSyncStatus(status);
    } catch (err) {
      console.error("Fetch failed:", err);
      setOperationError({ type: "pull", message: extractErrorMessage(err) });
    } finally {
      setFetchLoading(false);
    }
  }, [transport]);

  const pullFromOrigin = useCallback(async () => {
    setPullLoading(true);
    setOperationError(null);
    try {
      await transport.call("git_pull");
      const [commitResult, status] = await Promise.all([
        transport.call<CommitInfo[]>("get_commit_log"),
        transport.call<SyncStatus | null>("git_sync_status"),
      ]);
      setCommits(commitResult);
      setSyncStatus(status);
    } catch (err) {
      console.error("Pull failed:", err);
      setOperationError({ type: "pull", message: extractErrorMessage(err) });
    } finally {
      setPullLoading(false);
    }
  }, [transport]);

  const isVisible = usePageVisibility();
  const connectionState = useConnectionState();
  const canPoll = isVisible && connectionState === "connected";

  usePolling(canPoll ? fetchCommits : null, 2000);

  // Pre-warm the diff cache for the most recent commit so the first open is instant.
  useEffect(() => {
    if (commits.length > 0) {
      prefetchCommitDiff(commits[0].hash, transport);
    }
  }, [commits, transport]);

  useEffect(() => {
    if (commits.length === 0) return;

    const missing = commits
      .map((c) => c.hash)
      .filter((hash) => !requestedHashesRef.current.has(hash));

    if (missing.length === 0) return;

    // Mark as in-flight before async call
    for (const h of missing) requestedHashesRef.current.add(h);

    transport
      .call<Record<string, number>>("get_batch_file_counts", { hashes: missing })
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
  }, [commits, transport]);

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
    isStale,
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
