import { Task } from "../types/task";

interface TaskCardProps {
  task: Task;
  onMarkDone?: () => void;
  onClick?: () => void;
  isSelected?: boolean;
}

export function TaskCard({ task, onMarkDone, onClick, isSelected }: TaskCardProps) {
  const isFailed = task.status === "failed";
  const isBlocked = task.status === "blocked";
  const hasActiveProcess = task.agent_pid !== undefined;
  const isInProgress = task.status === "in_progress";
  const isPlanning = task.status === "planning";
  const showSpinner = hasActiveProcess || isInProgress || isPlanning;

  // Task is resumable if it has session_id, no running process, and is incomplete
  const isResumable = task.session_id &&
    !task.agent_pid &&
    (task.status === "planning" || task.status === "in_progress");

  const borderClass = isFailed
    ? "border-red-300 bg-red-50"
    : isBlocked
    ? "border-orange-300 bg-orange-50"
    : isSelected
    ? "border-blue-500 ring-2 ring-blue-200"
    : "border-gray-200";

  return (
    <div
      className={`bg-white rounded-lg shadow-sm border p-4 ${borderClass} cursor-pointer hover:shadow-md transition-shadow`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-gray-900 text-sm">{task.title}</h3>
        {showSpinner && (
          <span className="flex-shrink-0 w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        )}
        {isFailed && (
          <span className="flex-shrink-0 text-red-500 font-bold">!</span>
        )}
        {isBlocked && (
          <span className="flex-shrink-0 text-orange-500 font-bold">||</span>
        )}
        {isResumable && (
          <span className="flex-shrink-0 text-amber-500" title="Session interrupted - can be resumed">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </span>
        )}
      </div>
      {task.description && (
        <p className="text-gray-500 text-xs mt-1 line-clamp-2">
          {task.description}
        </p>
      )}
      <div className="flex items-center justify-between mt-3">
        <span className="text-gray-400 text-xs font-mono">{task.id}</span>
        {onMarkDone && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMarkDone();
            }}
            className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
          >
            Mark Done
          </button>
        )}
      </div>
      {isFailed && task.error && (
        <p className="text-red-600 text-xs mt-2 p-2 bg-red-100 rounded">
          {task.error}
        </p>
      )}
      {isBlocked && task.error && (
        <p className="text-orange-600 text-xs mt-2 p-2 bg-orange-100 rounded">
          Blocked: {task.error}
        </p>
      )}
      {task.summary && (
        <p className="text-gray-600 text-xs mt-2 p-2 bg-gray-100 rounded">
          {task.summary}
        </p>
      )}
    </div>
  );
}
