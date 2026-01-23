import type { Task } from "../types/task";

interface TaskCardProps {
  task: Task;
  onClick?: () => void;
  isSelected?: boolean;
}

// Helper to check if a task needs review
const needsReview = (task: Task): boolean => {
  return (
    (task.status === "planning" && task.plan !== undefined) ||
    (task.status === "working" && task.summary !== undefined)
  );
};

export function TaskCard({ task, onClick, isSelected }: TaskCardProps) {
  const isFailed = task.status === "failed";
  const isBlocked = task.status === "blocked";
  const hasActiveProcess = task.agent_pid !== undefined;
  const isWorking = task.status === "working";
  const isPlanning = task.status === "planning";
  const taskNeedsReview = needsReview(task);
  // Show spinner if agent is running and not waiting for review
  const showSpinner = hasActiveProcess && !taskNeedsReview;

  // Task is resumable if it has sessions, no running process, and is incomplete
  const hasSession = task.sessions && Object.keys(task.sessions).length > 0;
  const isResumable =
    hasSession && !task.agent_pid && !taskNeedsReview && (isPlanning || isWorking);

  const borderClass = isFailed
    ? "border-red-300 bg-red-50"
    : isBlocked
      ? "border-orange-300 bg-orange-50"
      : taskNeedsReview
        ? "border-amber-400 bg-amber-50"
        : isSelected
          ? "border-blue-500 ring-2 ring-blue-200"
          : "border-gray-200";

  return (
    <button
      className={`bg-white rounded-lg shadow-sm border p-4 ${borderClass} cursor-pointer hover:shadow-md transition-shadow text-left`}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {task.auto_approve && (
            <span className="flex-shrink-0 text-indigo-500" title="Auto-progress enabled">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <title>Auto-progress enabled</title>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </span>
          )}
          <h3 className="font-medium text-gray-900 text-sm">{task.title}</h3>
        </div>
        {taskNeedsReview && (
          <span className="flex-shrink-0 text-amber-600 text-xs font-medium px-1.5 py-0.5 bg-amber-100 rounded">
            Review
          </span>
        )}
        {showSpinner && (
          <span className="flex-shrink-0 w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        )}
        {isFailed && <span className="flex-shrink-0 text-red-500 font-bold">!</span>}
        {isBlocked && <span className="flex-shrink-0 text-orange-500 font-bold">||</span>}
        {isResumable && (
          <span
            className="flex-shrink-0 text-amber-500"
            title="Session interrupted - can be resumed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <title>Session interrupted - can be resumed</title>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </span>
        )}
      </div>
      {task.description && (
        <p className="text-gray-500 text-xs mt-1 line-clamp-2">{task.description}</p>
      )}
      <div className="flex items-center justify-between mt-3">
        <span className="text-gray-400 text-xs font-mono">{task.id}</span>
      </div>
      {isFailed && task.error && (
        <p className="text-red-600 text-xs mt-2 p-2 bg-red-100 rounded">{task.error}</p>
      )}
      {isBlocked && task.error && (
        <p className="text-orange-600 text-xs mt-2 p-2 bg-orange-100 rounded">
          Blocked: {task.error}
        </p>
      )}
      {task.summary && task.status === "done" && (
        <p className="text-gray-600 text-xs mt-2 p-2 bg-gray-100 rounded">{task.summary}</p>
      )}
    </button>
  );
}
