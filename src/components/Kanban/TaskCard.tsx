/**
 * Task card for the kanban board.
 */

import type { WorkflowTask } from "../../types/workflow";
import { hasPendingQuestions, needsReview } from "../../types/workflow";
import { Panel } from "../ui";

interface TaskCardProps {
  task: WorkflowTask;
  onClick?: () => void;
  isSelected?: boolean;
}

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

export function TaskCard({ task, onClick, isSelected }: TaskCardProps) {
  const isFailed = task.status.type === "failed";
  const isBlocked = task.status.type === "blocked";
  const isDone = task.status.type === "done";
  const hasActiveProcess = task.phase === "agent_working";
  const taskNeedsReview = needsReview(task);
  const hasQuestions = hasPendingQuestions(task);

  const showSpinner = hasActiveProcess && !taskNeedsReview && !hasQuestions;

  const borderClass = isFailed
    ? "border-red-300 bg-red-50"
    : isBlocked
      ? "border-orange-300 bg-orange-50"
      : taskNeedsReview || hasQuestions
        ? "border-amber-400 bg-amber-50"
        : isSelected
          ? "border-sage-500 ring-2 ring-sage-200"
          : "";

  const errorText =
    task.status.type === "failed"
      ? task.status.error
      : task.status.type === "blocked"
        ? task.status.reason
        : undefined;

  return (
    <Panel autoFill={false} className={borderClass}>
      <button onClick={onClick} type="button" className="text-left p-2 w-full">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium text-stone-800 text-sm">{getDisplayTitle(task)}</h3>
          <div className="flex items-center gap-1.5">
            {taskNeedsReview && (
              <span className="flex-shrink-0 text-amber-700 text-xs font-medium px-1.5 py-0.5 bg-amber-100 rounded-full">
                Review
              </span>
            )}
            {hasQuestions && !taskNeedsReview && (
              <span className="flex-shrink-0 text-info text-xs font-medium px-1.5 py-0.5 bg-blue-100 rounded-full">
                Questions
              </span>
            )}
            {showSpinner && (
              <span className="flex-shrink-0 w-4 h-4 border-2 border-sage-500 border-t-transparent rounded-full animate-spin" />
            )}
            {isFailed && <span className="flex-shrink-0 text-error font-bold">!</span>}
            {isBlocked && <span className="flex-shrink-0 text-blocked font-bold">||</span>}
          </div>
        </div>

        {task.description && task.title && (
          <p className="text-stone-500 text-xs mt-1 line-clamp-2">{task.description}</p>
        )}

        <div className="mt-3">
          <span className="text-stone-400 text-xs font-mono">{task.id}</span>
        </div>

        {errorText && (isFailed || isBlocked) && (
          <p
            className={`text-xs mt-2 p-2 rounded-panel-sm ${
              isFailed ? "text-error bg-red-100" : "text-blocked bg-orange-100"
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
