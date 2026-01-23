import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toRelativePath, useProjectRoot } from "../hooks/useProjectRoot";
import {
  type LogEntry,
  type OrkAction,
  type SessionInfo,
  TASK_STATUS_CONFIG,
  type Task,
  type ToolInput,
} from "../types/task";
import { TodoDisplay } from "./TodoDisplay";
import { getOrkSubIcon, ToolIcon } from "./ToolIcon";

type TabType = "details" | "breakdown" | "plan" | "logs";

function formatOrkAction(action: OrkAction): string {
  switch (action.action) {
    case "complete":
      return action.summary
        ? `Complete ${action.task_id} (with summary)`
        : `Complete ${action.task_id}`;
    case "fail":
      return action.reason ? `Fail ${action.task_id} (with reason)` : `Fail ${action.task_id}`;
    case "block":
      return action.reason ? `Block ${action.task_id} (with reason)` : `Block ${action.task_id}`;
    case "set_plan":
      return `Set plan for ${action.task_id}`;
    case "approve":
      return `Approve ${action.task_id}`;
    case "approve_review":
      return `Approve review for ${action.task_id}`;
    case "reject_review":
      return action.feedback
        ? `Reject review for ${action.task_id} (with feedback)`
        : `Reject review for ${action.task_id}`;
    case "create_subtask":
      return `Create subtask: ${action.title || "(untitled)"}`;
    case "set_breakdown":
      return `Set breakdown for ${action.task_id}`;
    case "approve_breakdown":
      return `Approve breakdown for ${action.task_id}`;
    case "skip_breakdown":
      return `Skip breakdown for ${action.task_id}`;
    case "complete_subtask":
      return `Complete subtask ${action.subtask_id}`;
    case "other": {
      // Truncate the raw command for display
      const truncated = action.raw.length > 50 ? `${action.raw.slice(0, 50)}...` : action.raw;
      return truncated;
    }
  }
}

function formatToolInput(input: ToolInput, projectRoot: string | null): string {
  switch (input.tool) {
    case "bash":
      return input.command;
    case "read":
    case "write":
    case "edit":
      return toRelativePath(input.file_path, projectRoot);
    case "glob":
    case "grep":
      return input.pattern;
    case "task":
      return input.description;
    case "todo_write":
      return `${input.todos.length} item${input.todos.length !== 1 ? "s" : ""}`;
    case "ork":
      return formatOrkAction(input.ork_action);
    case "other":
      return input.summary;
  }
}

function ToolResultView({ tool, content }: { tool: string; content: string }) {
  const [expanded, setExpanded] = useState(false);
  const previewLength = 200;
  const isLong = content.length > previewLength;
  const preview = isLong ? `${content.slice(0, previewLength)}...` : content;

  return (
    <div className="border-l-2 border-green-500 pl-2 my-1 py-1 bg-gray-800 rounded-r">
      <button
        type="button"
        className="flex items-center gap-2 cursor-pointer bg-transparent border-0 p-0 text-left w-full"
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          className={`w-3 h-3 text-green-400 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-green-400 font-medium text-sm">{tool} Result</span>
        <span className="text-gray-500 text-xs">(subagent output)</span>
      </button>
      <div className="mt-1 text-gray-300 text-sm whitespace-pre-wrap">
        {expanded ? content : preview}
        {isLong && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="ml-1 text-green-400 hover:text-green-300 text-xs"
          >
            Show more
          </button>
        )}
      </div>
    </div>
  );
}

function SubagentToolResultView({ tool, content }: { tool: string; content: string }) {
  const [expanded, setExpanded] = useState(false);
  const previewLength = 100;
  const isLong = content.length > previewLength;
  const preview = isLong ? `${content.slice(0, previewLength)}...` : content;

  return (
    <div className="ml-4 border-l border-purple-500/50 pl-2 my-0.5 py-0.5 text-xs">
      <span className="text-purple-300">{tool}:</span>
      <span className="text-gray-400 ml-1">
        {expanded ? content : preview}
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="ml-1 text-purple-400 hover:text-purple-300"
          >
            {expanded ? "less" : "more"}
          </button>
        )}
      </span>
    </div>
  );
}

function OrkToolView({
  input,
  isSubagent,
}: {
  input: ToolInput & { tool: "ork" };
  isSubagent: boolean;
}) {
  const subIcon = getOrkSubIcon(input.ork_action.action);
  const SubIconComponent = subIcon.icon;
  const borderColor = isSubagent ? "border-indigo-500/50" : "border-indigo-500";
  const textColor = isSubagent ? "text-indigo-400" : "text-indigo-400";
  const iconSize = isSubagent ? 12 : 14;

  return (
    <div
      className={`${isSubagent ? "ml-4 border-l" : "border-l-2"} ${borderColor} pl-2 my-${isSubagent ? "0.5" : "1"} py-${isSubagent ? "0.5" : "1"}`}
    >
      <div className="flex items-center gap-1.5">
        <ToolIcon tool="Ork" size={iconSize} className={textColor} />
        <SubIconComponent size={iconSize} className={subIcon.className} />
        <span className={`${textColor} ${isSubagent ? "text-sm" : "font-medium"}`}>Ork</span>
        <span className={`${isSubagent ? "text-gray-500" : "text-gray-400"} text-xs font-mono`}>
          {formatOrkAction(input.ork_action)}
        </span>
      </div>
    </div>
  );
}

function LogEntryView({ entry, projectRoot }: { entry: LogEntry; projectRoot: string | null }) {
  switch (entry.type) {
    case "text":
      return <div className="text-gray-100 whitespace-pre-wrap py-1">{entry.content}</div>;
    case "tool_use":
      // Special handling for Ork commands
      if (entry.input.tool === "ork") {
        return <OrkToolView input={entry.input} isSubagent={false} />;
      }
      return (
        <div className="border-l-2 border-blue-500 pl-2 my-1 py-1">
          <div className="flex items-center gap-1.5">
            <ToolIcon tool={entry.tool} size={14} className="text-blue-400" />
            <span className="text-blue-400 font-medium">{entry.tool}</span>
            <span className="text-gray-400 text-xs font-mono">
              {formatToolInput(entry.input, projectRoot)}
            </span>
          </div>
          {entry.input.tool === "todo_write" && <TodoDisplay todos={entry.input.todos} />}
        </div>
      );
    case "tool_result":
      return <ToolResultView tool={entry.tool} content={entry.content} />;
    case "subagent_tool_use":
      // Special handling for Ork commands in subagents
      if (entry.input.tool === "ork") {
        return <OrkToolView input={entry.input} isSubagent={true} />;
      }
      return (
        <div className="ml-4 border-l border-purple-500/50 pl-2 my-0.5 py-0.5">
          <div className="flex items-center gap-1.5">
            <ToolIcon tool={entry.tool} size={12} className="text-purple-400" />
            <span className="text-purple-400 text-sm">{entry.tool}</span>
            <span className="text-gray-500 text-xs font-mono">
              {formatToolInput(entry.input, projectRoot)}
            </span>
          </div>
          {entry.input.tool === "todo_write" && <TodoDisplay todos={entry.input.todos} />}
        </div>
      );
    case "subagent_tool_result":
      return <SubagentToolResultView tool={entry.tool} content={entry.content} />;
    case "process_exit":
      return (
        <div className="text-gray-500 py-1 text-sm">
          Process exited with code {entry.code ?? "unknown"}
        </div>
      );
    case "error":
      return <div className="text-red-400 py-1">{entry.message}</div>;
  }
}

interface TaskDetailSidebarProps {
  task: Task;
  onClose: () => void;
  onTaskUpdated: () => void;
}

// Helper to check review states
const needsPlanReview = (task: Task): boolean =>
  task.status === "planning" && task.plan !== undefined;

const needsBreakdownReview = (task: Task): boolean =>
  task.status === "breaking_down" && task.breakdown !== undefined;

const needsWorkReview = (task: Task): boolean =>
  task.status === "working" && task.summary !== undefined;

export function TaskDetailSidebar({ task, onClose, onTaskUpdated }: TaskDetailSidebarProps) {
  const [feedback, setFeedback] = useState("");
  const [breakdownFeedback, setBreakdownFeedback] = useState("");
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTogglingAutoApprove, setIsTogglingAutoApprove] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("details");
  const [autoScroll, setAutoScroll] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const statusConfig = TASK_STATUS_CONFIG[task.status];
  const projectRoot = useProjectRoot();

  // Fetch subtasks (checklist items) for the task
  // biome-ignore lint/correctness/useExhaustiveDependencies: task.status is intentionally included to refresh when status changes
  useEffect(() => {
    const fetchSubtasks = async () => {
      try {
        const result = await invoke<Task[]>("get_subtasks", { parentId: task.id });
        setSubtasks(result);
      } catch {
        setSubtasks([]);
      }
    };
    fetchSubtasks();
  }, [task.id, task.status]);

  // Get available sessions from the task
  const availableSessions = useMemo(() => {
    const sessions: { key: string; label: string; info: SessionInfo }[] = [];
    if (task.sessions) {
      // Keys are ordered by insertion time (creation order)
      for (const [key, info] of Object.entries(task.sessions)) {
        let label = key;
        if (key === "plan") label = "Plan";
        else if (key === "breakdown") label = "Breakdown";
        else if (key === "work") label = "Work";
        else if (key === "review") label = "Review";
        else if (key.startsWith("review_")) {
          const idx = parseInt(key.replace("review_", ""), 10);
          label = `Review ${idx + 1}`;
        } else if (key.startsWith("breakdown_")) {
          const idx = parseInt(key.replace("breakdown_", ""), 10);
          label = `Breakdown ${idx + 1}`;
        }
        sessions.push({ key, label, info });
      }
    }
    return sessions;
  }, [task.sessions]);

  // Set default active session to the most recent one
  useEffect(() => {
    if (availableSessions.length > 0 && !activeSession) {
      setActiveSession(availableSessions[availableSessions.length - 1].key);
    }
  }, [availableSessions, activeSession]);

  // Fetch logs for the active session
  const fetchLogs = useCallback(async () => {
    if (!activeSession) {
      setLogs([]);
      return;
    }
    setLogsLoading(true);
    try {
      const result = await invoke<LogEntry[]>("get_task_logs", {
        id: task.id,
        sessionKey: activeSession,
      });
      setLogs(result);
    } catch (err) {
      console.error("Failed to fetch logs:", err);
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, [task.id, activeSession]);

  // Fetch logs when task or active session changes
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Listen for real-time log updates via Tauri events (throttled) with polling fallback
  // Note: fetchLogs and onTaskUpdated are stable callbacks from useCallback/props
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let throttleTimeout: ReturnType<typeof setTimeout> | null = null;
    let pendingUpdate = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    // Determine if task is in an active state where logs are being generated
    const isActiveTask = ["planning", "breaking_down", "working"].includes(task.status);

    const handleUpdate = () => {
      // Refresh task data to get updated sessions
      onTaskUpdated();
      // Then fetch logs
      fetchLogs();
    };

    // Subscribe to task-logs-updated events (primary mechanism)
    listen<string>("task-logs-updated", (event) => {
      // Only process if this event is for our task
      if (event.payload !== task.id) return;

      // Throttle updates to max once per 200ms
      if (throttleTimeout) {
        pendingUpdate = true;
        return;
      }

      handleUpdate();
      throttleTimeout = setTimeout(() => {
        throttleTimeout = null;
        if (pendingUpdate) {
          pendingUpdate = false;
          handleUpdate();
        }
      }, 200);
    }).then((fn) => {
      unlisten = fn;
    });

    // Polling fallback for active tasks
    if (isActiveTask) {
      pollInterval = setInterval(fetchLogs, 1000);
    }

    return () => {
      if (unlisten) {
        unlisten();
      }
      if (throttleTimeout) {
        clearTimeout(throttleTimeout);
      }
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [task.id, task.status, fetchLogs, onTaskUpdated]);

  // Reset active session when task changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: task.id triggers reset when selected task changes
  useEffect(() => {
    setActiveSession(null);
    setLogs([]);
  }, [task.id]);

  const hasPlan = Boolean(task.plan);

  const hasSubtasks = subtasks.length > 0;

  // Reset active tab when task changes, and handle conditional tab visibility
  // biome-ignore lint/correctness/useExhaustiveDependencies: task.id triggers reset when selected task changes
  useEffect(() => {
    // If currently on plan tab but plan doesn't exist, switch to details
    if (activeTab === "plan" && !hasPlan) {
      setActiveTab("details");
    }
    // If currently on breakdown tab but no subtasks exist, switch to details
    if (activeTab === "breakdown" && !hasSubtasks) {
      setActiveTab("details");
    }
  }, [task.id, hasPlan, hasSubtasks, activeTab]);

  const handleLogsScroll = () => {
    if (!logsContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 10; // 10px threshold
    setAutoScroll(isAtBottom);
  };

  // Auto-scroll effect
  // biome-ignore lint/correctness/useExhaustiveDependencies: logs triggers scroll when new logs arrive
  useEffect(() => {
    if (autoScroll && logsContainerRef.current && activeTab === "logs") {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll, activeTab]);

  // Scroll to bottom when switching to logs tab or when task changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: task.id triggers scroll when task changes
  useEffect(() => {
    if (activeTab === "logs" && logsContainerRef.current && logs.length > 0) {
      // Use requestAnimationFrame to ensure the DOM has rendered
      requestAnimationFrame(() => {
        if (logsContainerRef.current) {
          logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
        }
      });
    }
  }, [activeTab, task.id]);

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

  const taskNeedsPlanReview = needsPlanReview(task);
  const taskNeedsBreakdownReview = needsBreakdownReview(task);
  const taskNeedsWorkReview = needsWorkReview(task);

  // Reset review feedback when task changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: task.id triggers reset when selected task changes
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

  const handleApproveBreakdown = async () => {
    setIsSubmitting(true);
    try {
      await invoke("approve_breakdown", { id: task.id });
      onTaskUpdated();
    } catch (err) {
      console.error("Failed to approve breakdown:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestBreakdownChanges = async () => {
    if (!breakdownFeedback.trim()) return;
    setIsSubmitting(true);
    try {
      await invoke("request_breakdown_changes", {
        id: task.id,
        feedback: breakdownFeedback.trim(),
      });
      setBreakdownFeedback("");
      onTaskUpdated();
    } catch (err) {
      console.error("Failed to request breakdown changes:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkipBreakdown = async () => {
    setIsSubmitting(true);
    try {
      await invoke("skip_breakdown", { id: task.id });
      onTaskUpdated();
    } catch (err) {
      console.error("Failed to skip breakdown:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleAutoApprove = async () => {
    setIsTogglingAutoApprove(true);
    try {
      await invoke("set_task_auto_approve", { id: task.id, enabled: !task.auto_approve });
      onTaskUpdated();
    } catch (err) {
      console.error("Failed to toggle auto-approve:", err);
    } finally {
      setIsTogglingAutoApprove(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await invoke("delete_task", { id: task.id });
      onTaskUpdated();
      onClose();
    } catch (err) {
      console.error("Failed to delete task:", err);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // Only show auto-approve toggle when task is not actively being worked on by an agent
  const canToggleAutoApprove =
    !task.agent_pid &&
    (task.status === "done" ||
      task.status === "failed" ||
      task.status === "blocked" ||
      taskNeedsPlanReview ||
      taskNeedsBreakdownReview ||
      taskNeedsWorkReview);

  return (
    <div className="w-1/2 flex-shrink-0 bg-white shadow-xl border-l border-gray-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-gray-500">{task.id}</span>
          <span
            className={`px-2 py-0.5 text-xs rounded-full ${
              task.status === "done"
                ? "bg-green-100 text-green-700"
                : task.status === "working"
                  ? "bg-blue-100 text-blue-700"
                  : task.status === "waiting_on_subtasks"
                    ? "bg-cyan-100 text-cyan-700"
                    : task.status === "planning"
                      ? "bg-purple-100 text-purple-700"
                      : task.status === "breaking_down"
                        ? "bg-indigo-100 text-indigo-700"
                        : task.status === "failed"
                          ? "bg-red-100 text-red-700"
                          : task.status === "blocked"
                            ? "bg-orange-100 text-orange-700"
                            : "bg-gray-100 text-gray-700"
            }`}
          >
            {statusConfig.label}
          </span>
          {(taskNeedsPlanReview || taskNeedsBreakdownReview || taskNeedsWorkReview) && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700">
              Review
            </span>
          )}
          {task.auto_approve && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-indigo-100 text-indigo-700">
              Auto
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canToggleAutoApprove && (
            <button
              type="button"
              onClick={handleToggleAutoApprove}
              disabled={isTogglingAutoApprove}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                task.auto_approve
                  ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              } disabled:opacity-50`}
              title={task.auto_approve ? "Disable auto-approve" : "Enable auto-approve"}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              Auto
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={Boolean(task.agent_pid) || isDeleting}
            className="p-1 hover:bg-red-100 rounded transition-colors text-red-500 hover:text-red-600 disabled:opacity-50"
            title="Delete task"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <svg
              className="w-5 h-5 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
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
      </div>

      {/* Tab Bar */}
      <div className="flex-shrink-0 flex border-b border-gray-200">
        <button
          type="button"
          onClick={() => setActiveTab("details")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "details"
              ? "bg-gray-100 text-gray-900 border-b-2 border-blue-500"
              : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
          }`}
        >
          Details
        </button>
        {hasSubtasks && (
          <button
            type="button"
            onClick={() => setActiveTab("breakdown")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "breakdown"
                ? "bg-gray-100 text-gray-900 border-b-2 border-blue-500"
                : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
            }`}
          >
            Breakdown
          </button>
        )}
        {hasPlan && (
          <button
            type="button"
            onClick={() => setActiveTab("plan")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "plan"
                ? "bg-gray-100 text-gray-900 border-b-2 border-blue-500"
                : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
            }`}
          >
            Plan
          </button>
        )}
        <button
          type="button"
          onClick={() => setActiveTab("logs")}
          className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${
            activeTab === "logs"
              ? "bg-gray-100 text-gray-900 border-b-2 border-blue-500"
              : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
          }`}
        >
          Logs
          {task.agent_pid && <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />}
        </button>
      </div>

      {/* Tab Content Area */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Details Tab */}
        {activeTab === "details" && (
          <div className="flex-1 overflow-auto p-4">
            <h2 className="font-semibold text-lg text-gray-900">{task.title}</h2>
            {task.description && <p className="text-gray-600 text-sm mt-2">{task.description}</p>}
            {task.summary && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded">
                <div className="text-xs font-medium text-green-700 mb-1">Summary</div>
                <div className="prose prose-sm max-w-none prose-headings:text-green-800 prose-p:text-green-800 prose-li:text-green-800 prose-code:bg-green-100 prose-code:px-1 prose-code:rounded">
                  <ReactMarkdown>{task.summary}</ReactMarkdown>
                </div>
              </div>
            )}
            {task.error && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
                <div className="text-xs font-medium text-red-700 mb-1">Error</div>
                <p className="text-sm text-red-800">{task.error}</p>
              </div>
            )}
          </div>
        )}

        {/* Breakdown Tab */}
        {activeTab === "breakdown" && hasSubtasks && (
          <div className="flex-1 overflow-auto p-4">
            <div className="text-sm font-medium text-gray-700 mb-3">
              Subtasks ({subtasks.filter((s) => s.status === "done").length}/{subtasks.length})
            </div>
            <div className="space-y-2">
              {subtasks.map((subtask) => (
                <div
                  key={subtask.id}
                  className={`flex items-start gap-2 p-3 rounded border ${
                    subtask.status === "done"
                      ? "bg-green-50 border-green-200"
                      : "bg-white border-gray-200"
                  }`}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {subtask.status === "done" ? (
                      <svg
                        className="w-5 h-5 text-green-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : (
                      <div className="w-5 h-5 border-2 border-gray-300 rounded" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-sm font-medium ${
                        subtask.status === "done" ? "text-green-700 line-through" : "text-gray-900"
                      }`}
                    >
                      {subtask.title}
                    </div>
                    {subtask.description && (
                      <div className="text-xs text-gray-500 mt-1">{subtask.description}</div>
                    )}
                  </div>
                  <div className="flex-shrink-0 text-xs font-mono text-gray-400">{subtask.id}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Plan Tab */}
        {activeTab === "plan" && hasPlan && (
          <div className="flex-1 overflow-auto p-4">
            <div className="prose prose-sm max-w-none prose-headings:text-gray-800 prose-p:text-gray-700 prose-li:text-gray-700 prose-code:bg-gray-100 prose-code:px-1 prose-code:rounded prose-pre:bg-gray-100 prose-pre:text-gray-800">
              <ReactMarkdown>{task.plan}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* Logs Tab */}
        {activeTab === "logs" && (
          <div
            ref={logsContainerRef}
            onScroll={handleLogsScroll}
            className="flex-1 overflow-auto min-h-0 bg-gray-900"
          >
            {/* Session Sub-Tabs (if multiple sessions exist) - sticky at top */}
            {availableSessions.length > 1 && (
              <div className="sticky top-0 z-10 px-4 py-2 border-b border-gray-700 bg-gray-800 flex gap-2 overflow-x-auto">
                {availableSessions.map((session) => (
                  <button
                    type="button"
                    key={session.key}
                    onClick={() => setActiveSession(session.key)}
                    className={`px-3 py-1 text-xs rounded whitespace-nowrap ${
                      activeSession === session.key
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    {session.label}
                  </button>
                ))}
              </div>
            )}
            <div className="p-4">
              {logsLoading && logs.length === 0 ? (
                <div className="text-gray-500 text-sm">Loading logs...</div>
              ) : logs.length > 0 ? (
                <div className="text-sm font-mono space-y-1">
                  {logs.map((entry, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: logs have no stable IDs
                    <LogEntryView key={index} entry={entry} projectRoot={projectRoot} />
                  ))}
                </div>
              ) : (
                <div className="text-gray-500 text-sm">
                  No logs available yet. Logs will appear here once the agent starts working.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Plan Approval Actions */}
      {taskNeedsPlanReview && !task.auto_approve && (
        <div className="flex-shrink-0 p-4 border-t border-gray-200 bg-amber-50">
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
              type="button"
              onClick={handleRequestChanges}
              disabled={isSubmitting}
              className="w-full px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              Request Changes
            </button>
          ) : (
            <button
              type="button"
              onClick={handleApprove}
              disabled={isSubmitting}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              Approve & Start Breakdown
            </button>
          )}
        </div>
      )}

      {/* Breakdown Approval Actions */}
      {taskNeedsBreakdownReview && !task.auto_approve && (
        <div className="flex-shrink-0 p-4 border-t border-gray-200 bg-indigo-50">
          <div className="text-sm font-medium text-indigo-800 mb-3">Breakdown Review</div>
          {task.breakdown && (
            <div className="mb-3 p-2 bg-white rounded border border-indigo-200 max-h-32 overflow-auto prose prose-sm max-w-none prose-headings:text-indigo-900 prose-p:text-indigo-900 prose-li:text-indigo-900 prose-code:bg-indigo-50 prose-code:px-1 prose-code:rounded">
              <ReactMarkdown>{task.breakdown}</ReactMarkdown>
            </div>
          )}
          <textarea
            value={breakdownFeedback}
            onChange={(e) => setBreakdownFeedback(e.target.value)}
            placeholder="Leave feedback to request changes..."
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none mb-3"
            rows={2}
          />
          {breakdownFeedback.trim() ? (
            <button
              type="button"
              onClick={handleRequestBreakdownChanges}
              disabled={isSubmitting}
              className="w-full px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              Request Changes
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleApproveBreakdown}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                Approve & Start Subtasks
              </button>
              <button
                type="button"
                onClick={handleSkipBreakdown}
                disabled={isSubmitting}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 transition-colors"
                title="Skip breakdown and work on this task directly"
              >
                Skip
              </button>
            </div>
          )}
        </div>
      )}

      {/* Work Review Actions */}
      {taskNeedsWorkReview && !task.auto_approve && (
        <div className="flex-shrink-0 p-4 border-t border-gray-200 bg-yellow-50">
          <div className="text-sm font-medium text-yellow-800 mb-3">Work Review</div>
          <textarea
            value={reviewFeedback}
            onChange={(e) => setReviewFeedback(e.target.value)}
            placeholder="Add feedback for the agent..."
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500 resize-none mb-3"
            rows={2}
          />
          {reviewFeedback.trim() ? (
            <button
              type="button"
              onClick={handleRequestReviewChanges}
              disabled={isSubmitting}
              className="w-full px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              Request Changes
            </button>
          ) : (
            <button
              type="button"
              onClick={handleApproveReview}
              disabled={isSubmitting}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              Approve for Review
            </button>
          )}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Task?</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will permanently delete the task "{task.title}" and clean up its git
              branch/worktree. Any child tasks will also be deleted. This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
