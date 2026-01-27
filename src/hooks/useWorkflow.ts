/**
 * Hook for loading workflow configuration and managing workflow tasks.
 * Uses the new workflow_* Tauri commands.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import type {
  LogEntry,
  WorkflowArtifact,
  WorkflowConfig,
  WorkflowIteration,
  WorkflowQuestion,
  WorkflowQuestionAnswer,
  WorkflowTask,
} from "../types/workflow";

/**
 * Error returned by workflow commands.
 */
interface WorkflowError {
  code: string;
  message: string;
}

/**
 * Parse error from Tauri invoke.
 */
function parseError(err: unknown): WorkflowError {
  if (typeof err === "string") {
    try {
      return JSON.parse(err) as WorkflowError;
    } catch {
      return { code: "UNKNOWN", message: err };
    }
  }
  if (err instanceof Error) {
    return { code: "UNKNOWN", message: err.message };
  }
  return { code: "UNKNOWN", message: String(err) };
}

/**
 * Hook for loading workflow configuration.
 * Configuration is loaded once on mount.
 */
export function useWorkflowConfig() {
  const [config, setConfig] = useState<WorkflowConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<WorkflowError | null>(null);

  useEffect(() => {
    invoke<WorkflowConfig>("workflow_get_config")
      .then((result) => {
        setConfig(result);
        setError(null);
      })
      .catch((err) => {
        setError(parseError(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return { config, loading, error };
}

/**
 * Hook for managing workflow tasks.
 * Provides CRUD operations and automatic updates.
 */
export function useWorkflowTasks() {
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<WorkflowError | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const result = await invoke<WorkflowTask[]>("workflow_get_tasks");
      setTasks(result);
      setError(null);
    } catch (err) {
      setError(parseError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();

    // Poll for updates every 2 seconds
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

  const createTask = useCallback(async (title: string, description: string) => {
    const newTask = await invoke<WorkflowTask>("workflow_create_task", {
      title,
      description,
    });
    setTasks((prev) => [...prev, newTask]);
    return newTask;
  }, []);

  const createSubtask = useCallback(
    async (parentId: string, title: string, description: string) => {
      const newTask = await invoke<WorkflowTask>("workflow_create_subtask", {
        parentId,
        title,
        description,
      });
      setTasks((prev) => [...prev, newTask]);
      return newTask;
    },
    [],
  );

  const deleteTask = useCallback(async (taskId: string) => {
    await invoke<void>("workflow_delete_task", { taskId });
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  const getTask = useCallback(async (taskId: string) => {
    return invoke<WorkflowTask>("workflow_get_task", { taskId });
  }, []);

  const listSubtasks = useCallback(async (parentId: string) => {
    return invoke<WorkflowTask[]>("workflow_list_subtasks", { parentId });
  }, []);

  return {
    tasks,
    loading,
    error,
    createTask,
    createSubtask,
    deleteTask,
    getTask,
    listSubtasks,
    refetch: fetchTasks,
  };
}

/**
 * Hook for human review actions.
 */
export function useWorkflowActions() {
  const approve = useCallback(async (taskId: string) => {
    return invoke<WorkflowTask>("workflow_approve", { taskId });
  }, []);

  const reject = useCallback(async (taskId: string, feedback: string) => {
    return invoke<WorkflowTask>("workflow_reject", { taskId, feedback });
  }, []);

  const answerQuestions = useCallback(async (taskId: string, answers: WorkflowQuestionAnswer[]) => {
    return invoke<WorkflowTask>("workflow_answer_questions", { taskId, answers });
  }, []);

  const retry = useCallback(async (taskId: string) => {
    return invoke<WorkflowTask>("workflow_retry", { taskId });
  }, []);

  return { approve, reject, answerQuestions, retry };
}

/**
 * Hook for workflow queries.
 */
export function useWorkflowQueries() {
  const getIterations = useCallback(async (taskId: string) => {
    return invoke<WorkflowIteration[]>("workflow_get_iterations", { taskId });
  }, []);

  const getArtifact = useCallback(async (taskId: string, name: string) => {
    return invoke<WorkflowArtifact | null>("workflow_get_artifact", { taskId, name });
  }, []);

  const getPendingQuestions = useCallback(async (taskId: string) => {
    return invoke<WorkflowQuestion[]>("workflow_get_pending_questions", { taskId });
  }, []);

  const getCurrentStage = useCallback(async (taskId: string) => {
    return invoke<string | null>("workflow_get_current_stage", { taskId });
  }, []);

  const getRejectionFeedback = useCallback(async (taskId: string) => {
    return invoke<string | null>("workflow_get_rejection_feedback", { taskId });
  }, []);

  const getLogs = useCallback(async (taskId: string, stage?: string) => {
    return invoke<LogEntry[]>("workflow_get_logs", { taskId, stage });
  }, []);

  const getStagesWithLogs = useCallback(async (taskId: string) => {
    return invoke<string[]>("workflow_get_stages_with_logs", { taskId });
  }, []);

  return {
    getIterations,
    getArtifact,
    getPendingQuestions,
    getCurrentStage,
    getRejectionFeedback,
    getLogs,
    getStagesWithLogs,
  };
}

/**
 * Combined hook for all workflow functionality.
 */
export function useWorkflow() {
  const { config, loading: configLoading, error: configError } = useWorkflowConfig();
  const {
    tasks,
    loading: tasksLoading,
    error: tasksError,
    createTask,
    createSubtask,
    deleteTask,
    getTask,
    listSubtasks,
    refetch,
  } = useWorkflowTasks();
  const { approve, reject, answerQuestions, retry } = useWorkflowActions();
  const {
    getIterations,
    getArtifact,
    getPendingQuestions,
    getCurrentStage,
    getRejectionFeedback,
    getLogs,
    getStagesWithLogs,
  } = useWorkflowQueries();

  return {
    // Config
    config,

    // Tasks
    tasks,
    loading: configLoading || tasksLoading,
    error: configError || tasksError,

    // Task CRUD
    createTask,
    createSubtask,
    deleteTask,
    getTask,
    listSubtasks,
    refetch,

    // Actions
    approve,
    reject,
    answerQuestions,
    retry,

    // Queries
    getIterations,
    getArtifact,
    getPendingQuestions,
    getCurrentStage,
    getRejectionFeedback,
    getLogs,
    getStagesWithLogs,
  };
}
