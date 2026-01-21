import { Task, TASK_STATUS_CONFIG } from "../types/task";

interface TaskDetailSidebarProps {
  task: Task;
  onClose: () => void;
}

export function TaskDetailSidebar({ task, onClose }: TaskDetailSidebarProps) {
  const statusConfig = TASK_STATUS_CONFIG[task.status];

  return (
    <div className="fixed inset-y-0 right-0 w-[500px] bg-white shadow-xl border-l border-gray-200 flex flex-col z-50">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-gray-500">{task.id}</span>
          <span
            className={`px-2 py-0.5 text-xs rounded-full ${
              task.status === "done"
                ? "bg-green-100 text-green-700"
                : task.status === "in_progress"
                ? "bg-blue-100 text-blue-700"
                : task.status === "ready_for_review"
                ? "bg-yellow-100 text-yellow-700"
                : task.status === "failed"
                ? "bg-red-100 text-red-700"
                : task.status === "blocked"
                ? "bg-orange-100 text-orange-700"
                : "bg-gray-100 text-gray-700"
            }`}
          >
            {statusConfig.label}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
        >
          <svg
            className="w-5 h-5 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div className="p-4 border-b border-gray-200">
        <h2 className="font-semibold text-lg text-gray-900">{task.title}</h2>
        {task.description && (
          <p className="text-gray-600 text-sm mt-2">{task.description}</p>
        )}
        {task.summary && (
          <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded">
            <div className="text-xs font-medium text-green-700 mb-1">Summary</div>
            <p className="text-sm text-green-800">{task.summary}</p>
          </div>
        )}
        {task.error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
            <div className="text-xs font-medium text-red-700 mb-1">Error</div>
            <p className="text-sm text-red-800">{task.error}</p>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Agent Logs</span>
          {task.status === "in_progress" && (
            <span className="flex items-center gap-1 text-xs text-blue-600">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              Live
            </span>
          )}
        </div>
        <div className="flex-1 overflow-auto p-4 bg-gray-900">
          {task.logs ? (
            <pre className="text-sm text-gray-100 font-mono whitespace-pre-wrap break-words">
              {task.logs}
            </pre>
          ) : (
            <div className="text-gray-500 text-sm">
              No logs available yet. Logs will appear here once the agent finishes.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
