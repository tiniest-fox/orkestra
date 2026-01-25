/**
 * Task card for the workflow system.
 * Uses WorkflowTask type with stage-agnostic display.
 */

import type { WorkflowTask } from "../types/workflow";
import { needsReview, hasPendingQuestions } from "../types/workflow";

interface WorkflowTaskCardProps {
  task: WorkflowTask;
  onClick?: () => void;
  isSelected?: boolean;
}

/**
 * Get display title - uses title or truncated description.
 */
function getDisplayTitle(task: WorkflowTask): string {
  if (task.title) {
    return task.title;
  }
  const maxLength = 60;
  if (task.description.length <= maxLength) {
    return task.description;
  }
  return `${task.description.slice(0, maxLength)}...`;
}

export function WorkflowTaskCard({ task, onClick, isSelected }: WorkflowTaskCardProps) {
  const isFailed = task.status.type === "failed";
  const isBlocked = task.status.type === "blocked";
  const isDone = task.status.type === "done";
  const hasActiveProcess = task.phase === "agent_working";
  const taskNeedsReview = needsReview(task);
  const hasQuestions = hasPendingQuestions(task);

  // Show spinner if agent is running and not waiting for review/questions
  const showSpinner = hasActiveProcess && !taskNeedsReview && !hasQuestions;

  // Determine border styling based on state
  const borderClass = isFailed
    ? "border-red-300 bg-red-50"
    : isBlocked
      ? "border-orange-300 bg-orange-50"
      : taskNeedsReview || hasQuestions
        ? "border-amber-400 bg-amber-50"
        : isSelected
          ? "border-blue-500 ring-2 ring-blue-200"
          : "border-gray-200";

  // Get error/reason text for failed/blocked tasks
  const errorText =
    task.status.type === "failed"
      ? task.status.error
      : task.status.type === "blocked"
        ? task.status.reason
        : undefined;

  return (
    <button
      className={`bg-white rounded-lg shadow-sm border p-4 ${borderClass} cursor-pointer hover:shadow-md transition-shadow text-left w-full`}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-gray-900 text-sm">{getDisplayTitle(task)}</h3>
        <div className="flex items-center gap-1.5">
          {taskNeedsReview && (
            <span className="flex-shrink-0 text-amber-600 text-xs font-medium px-1.5 py-0.5 bg-amber-100 rounded">
              Review
            </span>
          )}
          {hasQuestions && !taskNeedsReview && (
            <span className="flex-shrink-0 text-blue-600 text-xs font-medium px-1.5 py-0.5 bg-blue-100 rounded">
              Questions
            </span>
          )}
          {showSpinner && (
            <span className="flex-shrink-0 w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          )}
          {isFailed && <span className="flex-shrink-0 text-red-500 font-bold">!</span>}
          {isBlocked && <span className="flex-shrink-0 text-orange-500 font-bold">||</span>}
        </div>
      </div>

      {task.description && task.title && (
        <p className="text-gray-500 text-xs mt-1 line-clamp-2">{task.description}</p>
      )}

      <div className="flex items-center justify-between mt-3">
        <span className="text-gray-400 text-xs font-mono">{task.id}</span>
        {task.status.type === "active" && (
          <span className="text-gray-400 text-xs">{task.status.stage}</span>
        )}
      </div>

      {errorText && (isFailed || isBlocked) && (
        <p
          className={`text-xs mt-2 p-2 rounded ${
            isFailed ? "text-red-600 bg-red-100" : "text-orange-600 bg-orange-100"
          }`}
        >
          {isFailed ? errorText : `Blocked: ${errorText}`}
        </p>
      )}

      {isDone && Object.keys(task.artifacts ?? {}).length > 0 && (
        <div className="text-gray-500 text-xs mt-2">
          {Object.keys(task.artifacts ?? {}).length} artifact(s)
        </div>
      )}
    </button>
  );
}
