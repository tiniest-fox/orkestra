/**
 * Hook for task detail interactions.
 *
 * Reads the task from TasksProvider context and provides:
 * - Derived state convenience accessors
 * - Stage config lookup from WorkflowConfigProvider
 * - Human review actions (approve, reject, answer, retry)
 */

import { useCallback, useState } from "react";
import { useTasks, useWorkflowConfig } from "../providers";
import { useTransport } from "../transport";
import type { WorkflowQuestionAnswer, WorkflowTask, WorkflowTaskView } from "../types/workflow";

interface UseTaskDetailResult {
  task: WorkflowTaskView;
  /** Display name for the current stage. */
  currentStageDisplayName: string;
  /** Whether the task is submitting an action. */
  isSubmitting: boolean;
  /** Approve the current stage. */
  approve: () => Promise<void>;
  /** Reject the current stage with feedback. */
  reject: (feedback: string) => Promise<void>;
  /** Answer pending questions. */
  answerQuestions: (answers: WorkflowQuestionAnswer[]) => Promise<void>;
  /** Retry a failed task, optionally with instructions for the agent. */
  retry: (instructions?: string) => Promise<void>;
  /** Toggle auto-advance mode. */
  setAutoMode: (taskId: string, autoMode: boolean) => Promise<void>;
  /** Interrupt a working task. */
  interrupt: () => Promise<void>;
  /** Resume an interrupted task, optionally with a message for the agent. */
  resume: (message?: string) => Promise<void>;
  /** Merge the Done task's branch into base. */
  mergeTask: () => Promise<void>;
  /** Create a pull request for the Done task. */
  openPr: () => Promise<void>;
  /** Retry PR creation after a failure. */
  retryPr: () => Promise<void>;
  /** Archive a Done task with a merged PR. */
  archiveTask: () => Promise<void>;
  /** Request update on a Done task with feedback. */
  requestUpdate: (feedback: string) => Promise<void>;
}

export function useTaskDetail(task: WorkflowTaskView): UseTaskDetailResult {
  const transport = useTransport();
  const config = useWorkflowConfig();
  const { refetch } = useTasks();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentStageConfig = task.derived.current_stage
    ? config.stages.find((s) => s.name === task.derived.current_stage)
    : null;

  const currentStageDisplayName =
    currentStageConfig?.display_name || task.derived.current_stage || "";

  const approve = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await transport.call<WorkflowTask>("approve", { task_id: task.id });
      refetch();
    } catch (err) {
      console.error("Failed to approve:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [transport, task.id, refetch]);

  const reject = useCallback(
    async (feedback: string) => {
      setIsSubmitting(true);
      try {
        await transport.call<WorkflowTask>("reject", { task_id: task.id, feedback });
        refetch();
      } catch (err) {
        console.error("Failed to reject:", err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [transport, task.id, refetch],
  );

  const answerQuestions = useCallback(
    async (answers: WorkflowQuestionAnswer[]) => {
      setIsSubmitting(true);
      try {
        await transport.call<WorkflowTask>("answer_questions", { task_id: task.id, answers });
        refetch();
      } catch (err) {
        console.error("Failed to submit answers:", err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [transport, task.id, refetch],
  );

  const retry = useCallback(
    async (instructions?: string) => {
      setIsSubmitting(true);
      try {
        await transport.call<WorkflowTask>("retry", { task_id: task.id, instructions });
        refetch();
      } catch (err) {
        console.error("Failed to retry task:", err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [transport, task.id, refetch],
  );

  const setAutoMode = useCallback(
    async (taskId: string, autoMode: boolean) => {
      await transport.call<WorkflowTask>("set_auto_mode", { task_id: taskId, auto_mode: autoMode });
      refetch();
    },
    [transport, refetch],
  );

  const interrupt = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await transport.call<WorkflowTask>("interrupt", { task_id: task.id });
      refetch();
    } catch (err) {
      console.error("Failed to interrupt:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [transport, task.id, refetch]);

  const resume = useCallback(
    async (message?: string) => {
      setIsSubmitting(true);
      try {
        await transport.call<WorkflowTask>("resume", {
          task_id: task.id,
          message: message || null,
        });
        refetch();
      } catch (err) {
        console.error("Failed to resume:", err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [transport, task.id, refetch],
  );

  const mergeTask = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await transport.call<WorkflowTask>("merge_task", { task_id: task.id });
      refetch();
    } catch (err) {
      console.error("Failed to merge task:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [transport, task.id, refetch]);

  const openPr = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await transport.call<WorkflowTask>("open_pr", { task_id: task.id });
      refetch();
    } catch (err) {
      console.error("Failed to open PR:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [transport, task.id, refetch]);

  const retryPr = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await transport.call<WorkflowTask>("retry_pr", { task_id: task.id });
      refetch();
    } catch (err) {
      console.error("Failed to retry PR:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [transport, task.id, refetch]);

  const archiveTask = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await transport.call<WorkflowTask>("archive", { task_id: task.id });
      refetch();
    } catch (err) {
      console.error("Failed to archive task:", err);
    } finally {
      setIsSubmitting(false);
    }
  }, [transport, task.id, refetch]);

  const requestUpdate = useCallback(
    async (feedback: string) => {
      setIsSubmitting(true);
      try {
        await transport.call<WorkflowTask>("request_update", {
          task_id: task.id,
          feedback,
        });
        refetch();
      } catch (err) {
        console.error("Failed to request update:", err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [transport, task.id, refetch],
  );

  return {
    task,
    currentStageDisplayName,
    isSubmitting,
    approve,
    reject,
    answerQuestions,
    retry,
    setAutoMode,
    interrupt,
    resume,
    mergeTask,
    openPr,
    retryPr,
    archiveTask,
    requestUpdate,
  };
}
