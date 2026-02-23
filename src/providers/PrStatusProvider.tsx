/**
 * Provider for PR status tracking with tiered polling.
 *
 * Background polling (10s): All tasks with pr_url where state !== "merged" | "closed"
 * Active polling (2s): Single task set via setActivePoll (e.g., PR tab open)
 *
 * Polling pauses when app loses focus (document.visibilityState === "hidden").
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
import { usePolling } from "../hooks/usePolling";
import type { PrStatus } from "../types/workflow";
import { useTasks } from "./TasksProvider";

interface PrStatusContextValue {
  /** Get PR status for a task (undefined if not fetched). */
  getPrStatus: (taskId: string) => PrStatus | undefined;
  /** Whether status is currently loading for a task. */
  isLoading: (taskId: string) => boolean;
  /** Request immediate fetch for a task (for manual refresh). */
  requestFetch: (taskId: string, prUrl: string) => void;
  /** Register a task for active polling (2s interval). Pass null to disable. */
  setActivePoll: (taskId: string | null) => void;
}

const PrStatusContext = createContext<PrStatusContextValue | null>(null);

/**
 * Access PR status for tasks. Must be used within PrStatusProvider.
 */
export function usePrStatus(): PrStatusContextValue {
  const ctx = useContext(PrStatusContext);
  if (!ctx) {
    throw new Error("usePrStatus must be used within PrStatusProvider");
  }
  return ctx;
}

/** Returns true if PR state is terminal (merged or closed). */
function isTerminalPrState(state: string | undefined): boolean {
  return state === "merged" || state === "closed";
}

interface PrStatusProviderProps {
  children: ReactNode;
}

export function PrStatusProvider({ children }: PrStatusProviderProps) {
  const { tasks } = useTasks();
  const [statuses, setStatuses] = useState<Map<string, PrStatus>>(new Map());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [isVisible, setIsVisible] = useState(() => document.visibilityState === "visible");
  const [activePollTaskId, setActivePollTaskId] = useState<string | null>(null);

  // Track in-flight fetches to avoid duplicate requests
  const inFlightRef = useRef<Set<string>>(new Set());

  // Track task IDs with terminal PR states (no more polling needed)
  const terminalTasksRef = useRef<Set<string>>(new Set());

  // Stable ref for tasks — avoids re-creating polling callbacks when tasks change
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  // Stable ref for activePollTaskId — avoids re-creating activePoll callback
  const activePollTaskIdRef = useRef(activePollTaskId);
  activePollTaskIdRef.current = activePollTaskId;

  // Track visibility changes
  useEffect(() => {
    const handler = () => setIsVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  const fetchPrStatus = useCallback(async (taskId: string, prUrl: string) => {
    // Skip if already in flight
    if (inFlightRef.current.has(taskId)) return;

    inFlightRef.current.add(taskId);
    setLoadingIds((prev) => new Set(prev).add(taskId));

    try {
      const status = await invoke<PrStatus>("workflow_get_pr_status", {
        prUrl,
      });
      setStatuses((prev) => {
        const next = new Map(prev);
        next.set(taskId, status);
        return next;
      });
      // Track terminal states so polling can skip them
      if (isTerminalPrState(status.state)) {
        terminalTasksRef.current.add(taskId);
      }
    } catch (err) {
      console.error(`[PrStatusProvider] Failed to fetch PR status for ${taskId}:`, err);
    } finally {
      inFlightRef.current.delete(taskId);
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  }, []);

  // Background polling (10s) — reads tasks via ref to avoid restarting on every task update
  const backgroundPoll = useCallback(async () => {
    const toFetch = tasksRef.current.flatMap((t) => {
      if (!t.pr_url) return [];
      // Skip if already known to be terminal
      if (terminalTasksRef.current.has(t.id)) return [];
      return [{ id: t.id, prUrl: t.pr_url }];
    });

    for (const { id, prUrl } of toFetch) {
      fetchPrStatus(id, prUrl);
    }
  }, [fetchPrStatus]);

  usePolling(isVisible ? backgroundPoll : null, 10_000);

  // Active polling (2s) — only when visible and a task is focused
  // activePollTaskId in deps so the cycle restarts immediately on task change
  // biome-ignore lint/correctness/useExhaustiveDependencies: activePollTaskId restarts the polling cycle on task change
  const activePoll = useCallback(async () => {
    const taskId = activePollTaskIdRef.current;
    if (!taskId) return;
    // Re-check terminal state each tick
    if (terminalTasksRef.current.has(taskId)) return;
    const task = tasksRef.current.find((t) => t.id === taskId);
    if (!task?.pr_url) return;
    await fetchPrStatus(taskId, task.pr_url);
  }, [activePollTaskId, fetchPrStatus]); // activePollTaskId restarts cycle on task change

  usePolling(isVisible && activePollTaskId ? activePoll : null, 2000);

  const getPrStatus = useCallback((taskId: string) => statuses.get(taskId), [statuses]);

  const isLoading = useCallback((taskId: string) => loadingIds.has(taskId), [loadingIds]);

  const requestFetch = useCallback(
    (taskId: string, prUrl: string) => {
      fetchPrStatus(taskId, prUrl);
    },
    [fetchPrStatus],
  );

  const value: PrStatusContextValue = {
    getPrStatus,
    isLoading,
    requestFetch,
    setActivePoll: setActivePollTaskId,
  };

  return <PrStatusContext.Provider value={value}>{children}</PrStatusContext.Provider>;
}
