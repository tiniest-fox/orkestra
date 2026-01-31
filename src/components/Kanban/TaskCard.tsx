/**
 * Task card for the kanban board.
 */

import { AlertCircle, Eye, GitBranch, Layers, MessageCircle, XCircle, Zap } from "lucide-react";
import type { SubtaskProgress, WorkflowTaskView } from "../../types/workflow";
import { titleCase } from "../../utils/formatters";
import { Badge, Panel } from "../ui";

interface TaskCardProps {
  task: WorkflowTaskView;
  onClick?: () => void;
  isSelected?: boolean;
  /** "board" (default) shows full card; "subtask" shows stage badge, hides ID/artifacts/subtask progress. */
  variant?: "board" | "subtask";
  /** Resolved dependency names (subtask variant only). */
  dependencyNames?: string[];
}

function SubtaskProgressBar({ progress }: { progress: SubtaskProgress }) {
  const donePercent = (progress.done / progress.total) * 100;
  const failedPercent = (progress.failed / progress.total) * 100;
  const inProgressPercent = (progress.in_progress / progress.total) * 100;

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Layers className="w-3 h-3 text-stone-400 dark:text-stone-500" />
        <span className="text-xs text-stone-500 dark:text-stone-400">
          {progress.done}/{progress.total} subtasks
          {progress.in_progress > 0 && (
            <span className="text-info-600 dark:text-info-400"> ({progress.in_progress} active)</span>
          )}
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
          {inProgressPercent > 0 && (
            <div
              className="bg-info-400 dark:bg-info-500 transition-all duration-300"
              style={{ width: `${inProgressPercent}%` }}
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

export function TaskCard({
  task,
  onClick,
  isSelected,
  variant = "board",
  dependencyNames,
}: TaskCardProps) {
  const { derived } = task;
  const isFailed = derived.is_failed;
  const isBlocked = derived.is_blocked;
  const isDone = derived.is_done;
  const hasActiveProcess = derived.is_working;
  const taskNeedsReview = derived.needs_review;
  const hasQuestions = derived.has_questions;
  const hasTitle = !!task.title;
  const isSubtask = variant === "subtask";

  const isSettingUp = task.phase === "setting_up";
  const showSpinner = hasActiveProcess && !taskNeedsReview && !hasQuestions;

  // Include subtask aggregate state in border highlights
  const effectiveQuestions = hasQuestions || !!derived.subtask_progress?.any_has_questions;
  const effectiveReview = taskNeedsReview || !!derived.subtask_progress?.any_needs_review;

  const borderClass = isFailed
    ? "border-error-300 bg-error-50 dark:border-error-700 dark:bg-error-950"
    : isBlocked
      ? "border-warning-300 bg-warning-50 dark:border-warning-700 dark:bg-warning-950"
      : effectiveQuestions
        ? "border-info-400 bg-info-50 dark:border-info-600 dark:bg-info-950"
        : effectiveReview
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
          {isSubtask && task.short_id && (
            <span className="text-stone-400 dark:text-stone-500 font-mono font-normal mr-1.5">
              {task.short_id}
            </span>
          )}
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
          {derived.is_waiting_on_children &&
            (derived.subtask_progress?.any_has_questions ? (
              <span className="flex-shrink-0 p-1.5 rounded-md bg-info-100 dark:bg-info-900">
                <MessageCircle className="w-4 h-4 text-info-600 dark:text-info-300" />
              </span>
            ) : derived.subtask_progress?.any_needs_review ? (
              <span className="flex-shrink-0 p-1.5 rounded-md bg-warning-100 dark:bg-warning-900">
                <Eye className="w-4 h-4 text-warning-700 dark:text-warning-300" />
              </span>
            ) : (
              <span className="flex-shrink-0 p-1.5 rounded-md bg-info-100 dark:bg-info-900">
                <Layers
                  className={`w-4 h-4 text-info-600 dark:text-info-300 ${derived.subtask_progress?.any_working ? "animate-spin-bounce" : ""}`}
                />
              </span>
            ))}
        </div>
      </div>

      {task.description && hasTitle && (
        <p className="text-stone-500 dark:text-stone-400 text-xs mt-1 line-clamp-2">
          {task.description}
        </p>
      )}

      {isSubtask && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div>
            {isDone ? (
              <Badge variant="success">Done</Badge>
            ) : isFailed ? (
              <Badge variant="error">Failed</Badge>
            ) : isBlocked ? (
              <Badge variant="blocked">Blocked</Badge>
            ) : derived.current_stage ? (
              <Badge variant="info">{titleCase(derived.current_stage)}</Badge>
            ) : null}
          </div>
          {dependencyNames && dependencyNames.length > 0 && (
            <span className="text-stone-400 dark:text-stone-500 text-xs font-mono truncate">
              Depends on {dependencyNames.join(", ")}
            </span>
          )}
        </div>
      )}

      {!isSubtask && derived.subtask_progress && (
        <SubtaskProgressBar progress={derived.subtask_progress} />
      )}

      {!isSubtask && (
        <span className="text-stone-400 dark:text-stone-500 text-xs font-mono mt-2.5">
          {task.id}
        </span>
      )}

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

      {!isSubtask && isDone && Object.keys(task.artifacts ?? {}).length > 0 && (
        <div className="text-stone-500 dark:text-stone-400 text-xs mt-2">
          {Object.keys(task.artifacts ?? {}).length} artifact(s)
        </div>
      )}
    </Panel>
  );
}
