/**
 * Provider for workflow tasks (rich views with iterations and derived state).
 *
 * Replaces the useWorkflowTasks() hook with a context-based approach.
 * Polls list_tasks every 2s and listens for "task_updated" events.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePageVisibility } from "../hooks/usePageVisibility";
import { usePolling } from "../hooks/usePolling";
import { useStalenessTimer } from "../hooks/useStalenessTimer";
import { startupData } from "../startup";

import { useConnectionState, useTransport } from "../transport";

import { useTransportListener } from "../transport/useTransportListener";
import type { DifferentialTaskResponse, WorkflowTask, WorkflowTaskView } from "../types/workflow";
import type { OptimisticAction } from "../utils/optimisticTransitions";
import { applyOptimisticTransition } from "../utils/optimisticTransitions";
import { isDisconnectError } from "../utils/transportErrors";
import { useWorkflowConfigState } from "./WorkflowConfigProvider";

const tasksCache = new Map<string, WorkflowTaskView[]>();
const archivedTasksCache = new Map<string, WorkflowTaskView[]>();

// Merges a differential response into the existing task list.
// Replaces updated tasks, preserves unchanged tasks, and removes deleted tasks.
// New tasks (in response but not in existing) are appended.
function mergeDifferentialResponse(
  existing: WorkflowTaskView[],
  diff: DifferentialTaskResponse,
): WorkflowTaskView[] {
  if (diff.tasks.length === 0 && diff.deleted_ids.length === 0) {
    return existing;
  }

  const deletedSet = new Set(diff.deleted_ids);
  const updatedMap = new Map(diff.tasks.map((t) => [t.id, t]));

  // Start from existing: remove deleted, replace updated.
  const merged = existing
    .filter((t) => !deletedSet.has(t.id))
    .map((t) => updatedMap.get(t.id) ?? t);

  // Append new tasks (in response but not in existing).
  const existingIds = new Set(existing.map((t) => t.id));
  for (const task of diff.tasks) {
    if (!existingIds.has(task.id)) {
      merged.push(task);
    }
  }

  return merged;
}

// Tracks a pre-action snapshot of updated_at plus when the entry was added,
// so fetchTasks can hold the optimistic state until the server confirms the change.
interface PendingEntry {
  preActionUpdatedAt: string;
  addedAt: number;
}

const PENDING_ENTRY_TTL_MS = 30_000;

// Merges server-fetched tasks with any pending optimistic state.
// Keeps the local optimistic version while updated_at is unchanged on the server.
// Sweeps entries for tasks absent from the result (e.g. archived) or older than TTL.
function reconcileWithPendingOptimistic(
  serverTasks: WorkflowTaskView[],
  pendingMap: Map<string, PendingEntry>,
  currentTasks: WorkflowTaskView[],
): WorkflowTaskView[] {
  if (pendingMap.size === 0) return serverTasks;

  const currentMap = new Map(currentTasks.map((t) => [t.id, t]));
  const result = serverTasks
    .map((serverTask): WorkflowTaskView | null => {
      const entry = pendingMap.get(serverTask.id);
      if (entry) {
        if (serverTask.updated_at === entry.preActionUpdatedAt) {
          // Server hasn't processed the action yet — keep optimistic version,
          // or drop if the task was removed (e.g. archived).
          return currentMap.get(serverTask.id) ?? null;
        }
        // Server has updated — clear pending and use server state.
        pendingMap.delete(serverTask.id);
      }
      return serverTask;
    })
    .filter((t): t is WorkflowTaskView => t !== null);

  // Sweep entries for tasks no longer in the result (archived) or stuck past TTL
  // (error-path: server never received the request).
  const resultIds = new Set(result.map((t) => t.id));
  const now = Date.now();
  for (const [id, entry] of pendingMap) {
    if (!resultIds.has(id) || now - entry.addedAt > PENDING_ENTRY_TTL_MS) {
      pendingMap.delete(id);
    }
  }

  return result;
}

interface TasksContextValue {
  tasks: WorkflowTaskView[];
  archivedTasks: WorkflowTaskView[];
  loading: boolean;
  error: unknown;
  isStale: boolean; // true when cached data is older than 5s
  createTask: (
    title: string,
    description: string,
    autoMode?: boolean,
    baseBranch?: string | null,
    flow?: string,
  ) => Promise<WorkflowTask>;
  createSubtask: (parentId: string, title: string, description: string) => Promise<WorkflowTask>;
  deleteTask: (taskId: string) => Promise<void>;
  applyOptimistic: (taskId: string, action: OptimisticAction) => void;
  refetch: () => Promise<void>;
}

const TasksContext = createContext<TasksContextValue | null>(null);

/**
 * Access tasks and CRUD operations. Must be used within TasksProvider.
 */
export function useTasks(): TasksContextValue {
  const ctx = useContext(TasksContext);
  if (!ctx) {
    throw new Error("useTasks must be used within TasksProvider");
  }
  return ctx;
}

interface TasksProviderProps {
  children: ReactNode;
}

export function TasksProvider({ children }: TasksProviderProps) {
  const transport = useTransport();
  const { config } = useWorkflowConfigState();
  const projectUrl = window.location.href;
  const cachedTasks = tasksCache.get(projectUrl) ?? null;
  const cachedArchived = archivedTasksCache.get(projectUrl) ?? null;
  const [tasks, setTasks] = useState<WorkflowTaskView[]>(() => cachedTasks ?? []);
  const [archivedTasks, setArchivedTasks] = useState<WorkflowTaskView[]>(
    () => cachedArchived ?? [],
  );
  const [loading, setLoading] = useState(!cachedTasks);
  const [error, setError] = useState<unknown>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number>(Date.now());
  const isStale = useStalenessTimer(lastFetchedAt);

  // Track task IDs with pending deletes so polling doesn't re-add them
  const deletingIdsRef = useRef<Set<string>>(new Set());
  // Track tasks with pending optimistic updates — maps taskId to PendingEntry
  const pendingOptimisticUpdates = useRef<Map<string, PendingEntry>>(new Map());
  // Always-current ref so fetchTasks can read tasks without a stale closure
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const firstFetchRef = useRef(true);
  // Tracks whether at least one successful fetch has completed.
  // Distinguishes "initial load not yet done" from "project has zero tasks",
  // so differential sync activates correctly even for empty projects.
  const hasFetchedRef = useRef(false);

  const fetchTasks = useCallback(async () => {
    try {
      let result: WorkflowTaskView[];

      // Fast path: use prefetched data pushed from Tauri on startup.
      if (firstFetchRef.current && startupData.value) {
        result = startupData.value.tasks;
        firstFetchRef.current = false;
        console.timeEnd("[startup] tasks");
      } else if (hasFetchedRef.current) {
        // Differential sync: send current timestamps, receive only changed tasks.
        const since: Record<string, string> = {};
        for (const task of tasksRef.current) {
          since[task.id] = task.updated_at;
        }
        const diff = await transport.call<DifferentialTaskResponse>("list_tasks", { since });
        result = mergeDifferentialResponse(tasksRef.current, diff);
      } else {
        result = await transport.call<WorkflowTaskView[]>("list_tasks");
        if (firstFetchRef.current) {
          firstFetchRef.current = false;
          console.timeEnd("[startup] tasks");
        }
      }

      result = reconcileWithPendingOptimistic(
        result,
        pendingOptimisticUpdates.current,
        tasksRef.current,
      );

      const deleting = deletingIdsRef.current;
      if (deleting.size > 0) {
        const fetched = result.filter((t) => !deleting.has(t.id));
        for (const id of deleting) {
          if (!result.some((t) => t.id === id)) {
            deleting.delete(id);
          }
        }
        setTasks(fetched);
        tasksCache.set(projectUrl, fetched);
      } else {
        setTasks(result);
        tasksCache.set(projectUrl, result);
      }
      hasFetchedRef.current = true;
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

  const fetchArchivedTasks = useCallback(async () => {
    try {
      const result = await transport.call<WorkflowTaskView[]>("get_archived_tasks");
      setArchivedTasks(result);
      archivedTasksCache.set(projectUrl, result);
    } catch (err) {
      if (!isDisconnectError(err)) {
        console.error("[fetchArchivedTasks] Error:", err);
      }
    }
  }, [transport, projectUrl]);

  const isVisible = usePageVisibility();
  const connectionState = useConnectionState();
  const canPoll = isVisible && connectionState === "connected";

  const { reset: resetPolling } = usePolling(canPoll ? fetchTasks : null, 2000);

  useEffect(() => {
    fetchArchivedTasks();
  }, [fetchArchivedTasks]);

  useTransportListener("task_updated", () => {
    fetchTasks();
    fetchArchivedTasks();
    resetPolling();
  });

  const createTask = useCallback(
    async (
      title: string,
      description: string,
      autoMode?: boolean,
      baseBranch?: string | null,
      flow?: string,
    ) => {
      const newTask = await transport.call<WorkflowTask>("create_task", {
        title,
        description,
        base_branch: baseBranch ?? undefined,
        auto_mode: autoMode ?? false,
        flow: flow ?? null,
      });
      // Refetch to get the full TaskView
      fetchTasks();
      return newTask;
    },
    [transport, fetchTasks],
  );

  const createSubtask = useCallback(
    async (parentId: string, title: string, description: string) => {
      const newTask = await transport.call<WorkflowTask>("create_subtask", {
        parent_id: parentId,
        title,
        description,
      });
      fetchTasks();
      return newTask;
    },
    [transport, fetchTasks],
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      deletingIdsRef.current.add(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      try {
        await transport.call<void>("delete_task", { task_id: taskId });
      } catch (err) {
        console.error(`[deleteTask] Failed to delete ${taskId}:`, err);
        deletingIdsRef.current.delete(taskId);
        throw err;
      }
    },
    [transport],
  );

  const applyOptimistic = useCallback(
    (taskId: string, action: OptimisticAction) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (!task || !config) return;

      const predicted = applyOptimisticTransition(task, action, config);
      if (!predicted) return; // action not valid from current state

      // Store pre-action snapshot for convergence check and TTL-based cleanup
      pendingOptimisticUpdates.current.set(taskId, {
        preActionUpdatedAt: task.updated_at,
        addedAt: Date.now(),
      });

      if (action.type === "archive") {
        // Move from tasks to archivedTasks
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
        setArchivedTasks((prev) => {
          // Deduplicate by ID
          if (prev.some((t) => t.id === taskId)) return prev;
          return [predicted, ...prev];
        });
      } else {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? predicted : t)));
      }
    },
    [config],
  );

  const value: TasksContextValue = {
    tasks,
    archivedTasks,
    loading,
    error,
    isStale,
    createTask,
    createSubtask,
    deleteTask,
    applyOptimistic,
    refetch: fetchTasks,
  };

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}
