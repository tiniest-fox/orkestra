import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Task, TASK_STATUS_CONFIG, LogEntry, ToolInput } from "../types/task";

function CollapsibleHeader({
  title,
  expanded,
  onToggle,
  rightContent
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  rightContent?: React.ReactNode;
}) {
  return (
    <div
      className="flex-shrink-0 px-4 py-2 border-b border-gray-200 flex items-center justify-between cursor-pointer hover:bg-gray-50"
      onClick={onToggle}
    >
      <div className="flex items-center gap-2">
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-sm font-medium text-gray-700">{title}</span>
      </div>
      {rightContent}
    </div>
  );
}

function formatToolInput(input: ToolInput): string {
  switch (input.tool) {
    case "bash":
      return input.command;
    case "read":
    case "write":
    case "edit":
      return input.file_path;
    case "glob":
    case "grep":
      return input.pattern;
    case "task":
      return input.description;
    case "other":
      return input.summary;
  }
}

function LogEntryView({ entry }: { entry: LogEntry }) {
  switch (entry.type) {
    case "text":
      return (
        <div className="text-gray-100 whitespace-pre-wrap py-1">
          {entry.content}
        </div>
      );
    case "tool_use":
      return (
        <div className="border-l-2 border-blue-500 pl-2 my-1 py-1">
          <span className="text-blue-400 font-medium">{entry.tool}</span>
          <span className="text-gray-400 text-xs ml-2 font-mono">
            {formatToolInput(entry.input)}
          </span>
        </div>
      );
    case "process_exit":
      return (
        <div className="text-gray-500 py-1 text-sm">
          Process exited with code {entry.code ?? "unknown"}
        </div>
      );
    case "error":
      return (
        <div className="text-red-400 py-1">
          {entry.message}
        </div>
      );
  }
}

interface TaskDetailSidebarProps {
  task: Task;
  onClose: () => void;
  onTaskUpdated: () => void;
}

export function TaskDetailSidebar({ task, onClose, onTaskUpdated }: TaskDetailSidebarProps) {
  const [feedback, setFeedback] = useState("");
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [planExpanded, setPlanExpanded] = useState(true);
  const [logsExpanded, setLogsExpanded] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const statusConfig = TASK_STATUS_CONFIG[task.status];

  const hasPlan = Boolean(task.plan);

  const togglePlan = () => {
    if (planExpanded && !logsExpanded) {
      // Switching from plan-only to logs-only
      setPlanExpanded(false);
      setLogsExpanded(true);
    } else {
      setPlanExpanded(!planExpanded);
    }
  };

  const toggleLogs = () => {
    if (logsExpanded && !planExpanded && hasPlan) {
      // Switching from logs-only to plan-only
      setLogsExpanded(false);
      setPlanExpanded(true);
    } else {
      setLogsExpanded(!logsExpanded);
    }
  };

  const handleLogsScroll = () => {
    if (!logsContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 10; // 10px threshold
    setAutoScroll(isAtBottom);
  };

  // Auto-scroll effect
  useEffect(() => {
    if (autoScroll && logsContainerRef.current && logsExpanded) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [task.logs, autoScroll, logsExpanded]);

  const handleApprove = async () => {
    setIsSubmitting(true);
    try {
      await invoke("approve_plan", { id: task.id });
      onTaskUpdated();
    } catch (err) {
      console.error("Failed to approve plan:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestChanges = async () => {
    if (!feedback.trim()) return;
    setIsSubmitting(true);
    try {
      await invoke("request_plan_changes", { id: task.id, feedback: feedback.trim() });
      setFeedback("");
      onTaskUpdated();
    } catch (err) {
      console.error("Failed to request changes:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isPlanning = task.status === "planning";
  const isAwaitingApproval = task.status === "awaiting_approval";
  const isInProgress = task.status === "in_progress";
  const isReadyForReview = task.status === "ready_for_review";

  // Reset review feedback when task changes
  useEffect(() => {
    setReviewFeedback("");
  }, [task.id]);

  const handleApproveReview = async () => {
    setIsSubmitting(true);
    try {
      await invoke("approve_review", { id: task.id });
      onTaskUpdated();
    } catch (err) {
      console.error("Failed to approve review:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestReviewChanges = async () => {
    if (!reviewFeedback.trim()) return;
    setIsSubmitting(true);
    try {
      await invoke("request_review_changes", { id: task.id, feedback: reviewFeedback.trim() });
      setReviewFeedback("");
      onTaskUpdated();
    } catch (err) {
      console.error("Failed to request review changes:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[500px] bg-white shadow-xl border-l border-gray-200 flex flex-col z-50 overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-gray-500">{task.id}</span>
          <span
            className={`px-2 py-0.5 text-xs rounded-full ${
              task.status === "done"
                ? "bg-green-100 text-green-700"
                : task.status === "in_progress"
                ? "bg-blue-100 text-blue-700"
                : task.status === "planning"
                ? "bg-purple-100 text-purple-700"
                : task.status === "awaiting_approval"
                ? "bg-amber-100 text-amber-700"
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
          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Task Info */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200">
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

      {/* Approval Actions */}
      {isAwaitingApproval && (
        <div className="flex-shrink-0 p-4 border-b border-gray-200 bg-amber-50">
          <div className="text-sm font-medium text-amber-800 mb-3">Plan Review</div>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Leave feedback to request changes..."
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none mb-3"
            rows={2}
          />
          {feedback.trim() ? (
            <button
              onClick={handleRequestChanges}
              disabled={isSubmitting}
              className="w-full px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              Request Changes
            </button>
          ) : (
            <button
              onClick={handleApprove}
              disabled={isSubmitting}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              Approve & Start Work
            </button>
          )}
        </div>
      )}

      {/* Review Actions */}
      {isReadyForReview && (
        <div className="flex-shrink-0 p-4 border-b border-gray-200 bg-yellow-50">
          <div className="text-sm font-medium text-yellow-800 mb-3">Review</div>
          <textarea
            value={reviewFeedback}
            onChange={(e) => setReviewFeedback(e.target.value)}
            placeholder="Add feedback for the agent..."
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500 resize-none mb-3"
            rows={2}
          />
          {reviewFeedback.trim() ? (
            <button
              onClick={handleRequestReviewChanges}
              disabled={isSubmitting}
              className="w-full px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              Request Changes
            </button>
          ) : (
            <button
              onClick={handleApproveReview}
              disabled={isSubmitting}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              Approve as Done
            </button>
          )}
        </div>
      )}

      {/* Plan Section (when available) - flex-1 to share space with logs */}
      {task.plan && (
        <div className={`flex flex-col border-b border-gray-200 min-h-0 ${planExpanded ? 'flex-1' : 'flex-shrink-0'}`}>
          <CollapsibleHeader
            title="Implementation Plan"
            expanded={planExpanded}
            onToggle={togglePlan}
          />
          {planExpanded && (
            <div className="flex-1 overflow-auto min-h-0 p-4">
              <div className="prose prose-sm max-w-none">
                <pre className="whitespace-pre-wrap text-sm text-gray-800 bg-gray-50 p-3 rounded border">
                  {task.plan}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Agent Logs - flex-1 to share space with plan */}
      <div className={`flex flex-col min-h-0 ${logsExpanded ? 'flex-1' : 'flex-shrink-0'}`}>
        <CollapsibleHeader
          title="Agent Logs"
          expanded={logsExpanded}
          onToggle={toggleLogs}
          rightContent={
            (isPlanning || isInProgress) ? (
              <span className="flex items-center gap-1 text-xs text-blue-600">
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                Live
              </span>
            ) : undefined
          }
        />
        {logsExpanded && (
          <div
            ref={logsContainerRef}
            onScroll={handleLogsScroll}
            className="flex-1 overflow-auto min-h-0 p-4 bg-gray-900"
          >
            {task.logs && task.logs.length > 0 ? (
              <div className="text-sm font-mono space-y-1">
                {task.logs.map((entry, index) => (
                  <LogEntryView key={index} entry={entry} />
                ))}
              </div>
            ) : (
              <div className="text-gray-500 text-sm">
                No logs available yet. Logs will appear here once the agent starts working.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
