/**
 * Provider for workflow tasks (rich views with iterations and derived state).
 *
 * Replaces the useWorkflowTasks() hook with a context-based approach.
 * Polls workflow_get_tasks every 2s and listens for "task-updated" events.
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
import { useTauriListener } from "../hooks/useTauriListener";
import { startupData } from "../main";
import type { WorkflowTask, WorkflowTaskView } from "../types/workflow";

interface TasksContextValue {
  tasks: WorkflowTaskView[];
  archivedTasks: WorkflowTaskView[];
  loading: boolean;
  error: unknown;
  createTask: (
    title: string,
    description: string,
    autoMode?: boolean,
    baseBranch?: string | null,
    flow?: string,
  ) => Promise<WorkflowTask>;
  createSubtask: (parentId: string, title: string, description: string) => Promise<WorkflowTask>;
  deleteTask: (taskId: string) => Promise<void>;
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
  const [tasks, setTasks] = useState<WorkflowTaskView[]>([]);
  const [archivedTasks, setArchivedTasks] = useState<WorkflowTaskView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // Track task IDs with pending deletes so polling doesn't re-add them
  const deletingIdsRef = useRef<Set<string>>(new Set());

  const firstFetchRef = useRef(true);

  const fetchTasks = useCallback(async () => {
    try {
      let result: WorkflowTaskView[];

      // Fast path: use prefetched data pushed from Tauri on startup.
      if (firstFetchRef.current && startupData.value) {
        result = startupData.value.tasks;
        firstFetchRef.current = false;
        console.timeEnd("[startup] tasks");
      } else {
        result = await invoke<WorkflowTaskView[]>("workflow_get_tasks");
        if (firstFetchRef.current) {
          firstFetchRef.current = false;
          console.timeEnd("[startup] tasks");
        }
      }

      const deleting = deletingIdsRef.current;
      if (deleting.size > 0) {
        const fetched = result.filter((t) => !deleting.has(t.id));
        for (const id of deleting) {
          if (!result.some((t) => t.id === id)) {
            deleting.delete(id);
          }
        }
        setTasks(fetched);
      } else {
        setTasks(result);
      }
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchArchivedTasks = useCallback(async () => {
    try {
      const result = await invoke<WorkflowTaskView[]>("workflow_get_archived_tasks");
      setArchivedTasks(result);
    } catch (err) {
      console.error("[fetchArchivedTasks] Error:", err);
    }
  }, []);

  const { reset: resetPolling } = usePolling(fetchTasks, 2000);

  useEffect(() => {
    fetchArchivedTasks();
  }, [fetchArchivedTasks]);

  useTauriListener("task-updated", () => {
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
      const newTask = await invoke<WorkflowTask>("workflow_create_task", {
        title,
        description,
        baseBranch: baseBranch ?? undefined,
        autoMode: autoMode ?? false,
        flow: flow ?? null,
      });
      // Refetch to get the full TaskView
      fetchTasks();
      return newTask;
    },
    [fetchTasks],
  );

  const createSubtask = useCallback(
    async (parentId: string, title: string, description: string) => {
      const newTask = await invoke<WorkflowTask>("workflow_create_subtask", {
        parentId,
        title,
        description,
      });
      fetchTasks();
      return newTask;
    },
    [fetchTasks],
  );

  const deleteTask = useCallback(async (taskId: string) => {
    deletingIdsRef.current.add(taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    try {
      await invoke<void>("workflow_delete_task", { taskId });
    } catch (err) {
      console.error(`[deleteTask] Failed to delete ${taskId}:`, err);
      deletingIdsRef.current.delete(taskId);
      throw err;
    }
  }, []);

  const value: TasksContextValue = {
    tasks,
    archivedTasks,
    loading,
    error,
    createTask,
    createSubtask,
    deleteTask,
    refetch: fetchTasks,
  };

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}
