import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Task, TaskStatus } from "../types/task";

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
    // Poll for updates every 2 seconds (will be replaced with file watcher events)
    const interval = setInterval(fetchTasks, 2000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const createTask = useCallback(async (title: string, description: string) => {
    try {
      // Creates task AND spawns an agent to work on it
      const newTask = await invoke<Task>("create_and_start_task", { title, description });
      setTasks((prev) => [...prev, newTask]);
      return newTask;
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const updateTaskStatus = useCallback(async (id: string, status: TaskStatus) => {
    try {
      const updated = await invoke<Task>("update_task_status", { id, status });
      setTasks((prev) =>
        prev.map((task) => (task.id === id ? updated : task))
      );
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
