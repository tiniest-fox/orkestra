/**
 * Task card for the kanban board.
 */

import { AlertCircle, Eye, MessageCircle, XCircle } from "lucide-react";
import type { WorkflowTaskView } from "../../types/workflow";
import { Panel } from "../ui";

interface TaskCardProps {
  task: WorkflowTaskView;
  onClick?: () => void;
  isSelected?: boolean;
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

  const showSpinner = hasActiveProcess && !taskNeedsReview && !hasQuestions;

  const borderClass = isFailed
    ? "border-error-300 bg-error-50"
    : isBlocked
      ? "border-warning-300 bg-warning-50"
      : taskNeedsReview || hasQuestions
        ? "border-warning-400 bg-warning-50"
        : isSelected
          ? "border-orange-500 ring-2 ring-orange-200"
          : "";

  const errorText =
    task.status.type === "failed"
      ? task.status.error
      : task.status.type === "blocked"
        ? task.status.reason
        : undefined;

  return (
    <Panel autoFill={false} className={borderClass}>
      <button onClick={onClick} type="button" className="text-left p-4 w-full">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium text-stone-800 text-sm line-clamp-2">
            {getDisplayTitle(task)}
          </h3>
          <div className="flex items-center gap-1.5">
            {taskNeedsReview && <Eye className="flex-shrink-0 w-4 h-4 text-warning-700" />}
            {hasQuestions && !taskNeedsReview && (
              <MessageCircle className="flex-shrink-0 w-4 h-4 text-info-600" />
            )}
            {showSpinner && (
              <span className="flex-shrink-0 w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            )}
            {isFailed && <XCircle className="flex-shrink-0 w-4 h-4 text-error-600" />}
            {isBlocked && <AlertCircle className="flex-shrink-0 w-4 h-4 text-warning-600" />}
          </div>
        </div>

        {task.description && task.title && (
          <p className="text-stone-500 text-xs mt-1 line-clamp-2">{task.description}</p>
        )}

        <span className="text-stone-400 text-xs font-mono mt-2.5">{task.id}</span>

        {errorText && (isFailed || isBlocked) && (
          <p
            className={`text-xs mt-2 p-2 rounded-panel-sm ${
              isFailed ? "text-error-700 bg-error-100" : "text-warning-700 bg-warning-100"
            }`}
          >
            {isFailed ? errorText : `Blocked: ${errorText}`}
          </p>
        )}

        {isDone && Object.keys(task.artifacts ?? {}).length > 0 && (
          <div className="text-stone-500 text-xs mt-2">
            {Object.keys(task.artifacts ?? {}).length} artifact(s)
          </div>
        )}
      </button>
    </Panel>
  );
}
