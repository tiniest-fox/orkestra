import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import type { Task, TaskStatus } from "../types/task";

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const result = await invoke<Task[]>("get_tasks");
      setTasks(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();

    // Poll for updates every 2 seconds
    // TODO: Replace with working Tauri event system
    const interval = setInterval(fetchTasks, 2000);

    // Also listen for task update events from Tauri backend
    const unlistenPromise = listen<string>("task-logs-updated", () => {
      fetchTasks();
    });

    return () => {
      clearInterval(interval);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [fetchTasks]);

  const createTask = useCallback(
    async (title: string | undefined, description: string, autoApprove?: boolean) => {
      try {
        // Creates task AND spawns an agent to work on it
        // If title is undefined or empty, the backend will auto-generate it
        const newTask = await invoke<Task>("create_and_start_task", {
          title: title || null,
          description,
          autoApprove: autoApprove ?? false,
        });
        setTasks((prev) => [...prev, newTask]);
        return newTask;
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  const updateTaskStatus = useCallback(async (id: string, status: TaskStatus) => {
    try {
      const updated = await invoke<Task>("update_task_status", { id, status });
      setTasks((prev) => prev.map((task) => (task.id === id ? updated : task)));
      return updated;
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return {
    tasks,
    loading,
    error,
    createTask,
    updateTaskStatus,
    refetch: fetchTasks,
  };
}
