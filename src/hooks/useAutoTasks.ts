import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { AutoTask, Task } from "../types/task";

export function useAutoTasks() {
  const [autoTasks, setAutoTasks] = useState<AutoTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAutoTasks = useCallback(async () => {
    try {
      const result = await invoke<AutoTask[]>("get_auto_tasks");
      setAutoTasks(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAutoTasks();
  }, [fetchAutoTasks]);

  const createFromAutoTask = useCallback(async (name: string): Promise<Task> => {
    try {
      const task = await invoke<Task>("create_task_from_auto_task", { name });
      return task;
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return {
    autoTasks,
    loading,
    error,
    createFromAutoTask,
    refetch: fetchAutoTasks,
  };
}
