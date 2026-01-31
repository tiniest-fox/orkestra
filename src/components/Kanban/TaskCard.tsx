/**
 * Task card for the kanban board.
 */

import { AlertCircle, Eye, GitBranch, Layers, MessageCircle, XCircle, Zap } from "lucide-react";
import type { SubtaskProgress, WorkflowTaskView } from "../../types/workflow";
import { Panel } from "../ui";

interface TaskCardProps {
  task: WorkflowTaskView;
  onClick?: () => void;
  isSelected?: boolean;
}

function SubtaskProgressBar({ progress }: { progress: SubtaskProgress }) {
  const donePercent = (progress.done / progress.total) * 100;
  const failedPercent = (progress.failed / progress.total) * 100;

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Layers className="w-3 h-3 text-stone-400 dark:text-stone-500" />
        <span className="text-xs text-stone-500 dark:text-stone-400">
          {progress.done}/{progress.total} subtasks
          {progress.failed > 0 && (
            <span className="text-error-600 dark:text-error-400"> ({progress.failed} failed)</span>
          )}
        </span>
      </div>
      <div className="h-1 bg-stone-200 dark:bg-stone-700 rounded-full overflow-hidden">
        <div className="h-full flex">
          {donePercent > 0 && (
            <div
              className="bg-success-500 dark:bg-success-400 transition-all duration-300"
              style={{ width: `${donePercent}%` }}
            />
          )}
          {failedPercent > 0 && (
            <div
              className="bg-error-500 dark:bg-error-400 transition-all duration-300"
              style={{ width: `${failedPercent}%` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function getDisplayTitle(task: WorkflowTaskView): string {
  if (task.title) {
    return task.title;
  }
  const maxLength = 60;
  if (task.description.length <= maxLength) {
    return task.description;
  }
  return `${task.description.slice(0, maxLength)}...`;
}

export function TaskCard({ task, onClick, isSelected }: TaskCardProps) {
  const { derived } = task;
  const isFailed = derived.is_failed;
  const isBlocked = derived.is_blocked;
  const isDone = derived.is_done;
  const hasActiveProcess = derived.is_working;
  const taskNeedsReview = derived.needs_review;
  const hasQuestions = derived.has_questions;
  const hasTitle = !!task.title;

  const isSettingUp = task.phase === "setting_up";
  const showSpinner = hasActiveProcess && !taskNeedsReview && !hasQuestions;

  const borderClass = isFailed
    ? "border-error-300 bg-error-50 dark:border-error-700 dark:bg-error-950"
    : isBlocked
      ? "border-warning-300 bg-warning-50 dark:border-warning-700 dark:bg-warning-950"
      : hasQuestions
        ? "border-info-400 bg-info-50 dark:border-info-600 dark:bg-info-950"
        : taskNeedsReview
          ? "border-warning-400 bg-warning-50 dark:border-warning-600 dark:bg-warning-950"
          : isSelected
            ? "border-orange-500 ring-2 ring-orange-200 dark:ring-orange-800"
            : "";

  const errorText =
    task.status.type === "failed"
      ? task.status.error
      : task.status.type === "blocked"
        ? task.status.reason
        : undefined;

  return (
    <Panel as="button" autoFill={false} padded onClick={onClick} className={borderClass}>
      <div className="flex items-start justify-between gap-2">
        <h3
          className={`font-medium text-sm line-clamp-2 ${hasTitle ? "text-stone-800 dark:text-stone-100" : "text-stone-400 dark:text-stone-500"}`}
        >
          {getDisplayTitle(task)}
        </h3>
        <div className="flex items-center gap-1.5">
          {isSettingUp && (
            <span className="flex-shrink-0 p-1.5">
              <GitBranch className="w-4 h-4 text-stone-400 dark:text-stone-500 animate-spin-bounce" />
            </span>
          )}
          {task.auto_mode && (
            <span className="flex-shrink-0 p-1.5 rounded-md bg-purple-100 dark:bg-purple-900">
              <Zap
                className={`w-4 h-4 text-purple-600 dark:text-purple-300 ${showSpinner ? "animate-spin-bounce" : ""}`}
              />
            </span>
          )}
          {hasQuestions && (
            <span className="flex-shrink-0 p-1.5 rounded-md bg-info-100 dark:bg-info-900">
              <MessageCircle className="w-4 h-4 text-info-600 dark:text-info-300" />
            </span>
          )}
          {taskNeedsReview && !hasQuestions && (
            <span className="flex-shrink-0 p-1.5 rounded-md bg-warning-100 dark:bg-warning-900">
              <Eye className="w-4 h-4 text-warning-700 dark:text-warning-300" />
            </span>
          )}
          {showSpinner && !task.auto_mode && (
            <span className="flex-shrink-0 p-1.5">
              <span className="block w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            </span>
          )}
          {isFailed && (
            <span className="flex-shrink-0 p-1.5 rounded-md bg-error-100 dark:bg-error-900">
              <XCircle className="w-4 h-4 text-error-600 dark:text-error-300" />
            </span>
          )}
          {isBlocked && (
            <span className="flex-shrink-0 p-1.5 rounded-md bg-warning-100 dark:bg-warning-900">
              <AlertCircle className="w-4 h-4 text-warning-600 dark:text-warning-300" />
            </span>
          )}
          {derived.is_waiting_on_children && (
            <span className="flex-shrink-0 p-1.5 rounded-md bg-info-100 dark:bg-info-900">
              <Layers className="w-4 h-4 text-info-600 dark:text-info-300" />
            </span>
          )}
        </div>
      </div>

      {task.description && hasTitle && (
        <p className="text-stone-500 dark:text-stone-400 text-xs mt-1 line-clamp-2">
          {task.description}
        </p>
      )}

      {derived.subtask_progress && <SubtaskProgressBar progress={derived.subtask_progress} />}

      <span className="text-stone-400 dark:text-stone-500 text-xs font-mono mt-2.5">{task.id}</span>

      {errorText && (isFailed || isBlocked) && (
        <p
          className={`text-xs mt-2 p-2 rounded-panel-sm ${
            isFailed
              ? "text-error-700 bg-error-100 dark:text-error-300 dark:bg-error-900"
              : "text-warning-700 bg-warning-100 dark:text-warning-300 dark:bg-warning-900"
          }`}
        >
          {isFailed ? errorText : `Blocked: ${errorText}`}
        </p>
      )}

      {isDone && Object.keys(task.artifacts ?? {}).length > 0 && (
        <div className="text-stone-500 dark:text-stone-400 text-xs mt-2">
          {Object.keys(task.artifacts ?? {}).length} artifact(s)
        </div>
      )}
    </Panel>
  );
}
