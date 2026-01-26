/**
 * Log entry display components for Claude Code session logs.
 * Renders tool uses, text output, and subagent activity.
 */

import {
  Command,
  FilePlus,
  FileText,
  FolderSearch,
  GitBranch,
  HelpCircle,
  ListTodo,
  Pencil,
  Search,
  Terminal,
} from "lucide-react";
import { useState } from "react";
import type { LogEntry, OrkAction, ResumeType, TodoItem, ToolInput } from "../types/workflow";

/**
 * Get icon for tool type.
 */
function getToolIcon(tool: string, size: number): React.ReactNode {
  const props = { size, strokeWidth: 2.5 };
  switch (tool.toLowerCase()) {
    case "bash":
      return <Terminal {...props} />;
    case "read":
      return <FileText {...props} />;
    case "write":
      return <FilePlus {...props} />;
    case "edit":
      return <Pencil {...props} />;
    case "glob":
      return <FolderSearch {...props} />;
    case "grep":
      return <Search {...props} />;
    case "task":
      return <GitBranch {...props} />;
    case "todowrite":
      return <ListTodo {...props} />;
    case "ork":
      return <Command {...props} />;
    default:
      return <HelpCircle {...props} />;
  }
}

/**
 * Get color class for tool type.
 */
function getToolColor(tool: string): string {
  switch (tool.toLowerCase()) {
    case "bash":
      return "bg-emerald-600";
    case "read":
      return "bg-blue-600";
    case "write":
      return "bg-amber-600";
    case "edit":
      return "bg-purple-600";
    case "glob":
    case "grep":
      return "bg-cyan-600";
    case "task":
      return "bg-pink-600";
    case "todowrite":
      return "bg-green-600";
    case "ork":
      return "bg-orange-600";
    default:
      return "bg-gray-600";
  }
}

/**
 * Format file path for display (truncate long paths).
 */
function formatPath(path: string): string {
  const maxLen = 50;
  if (path.length <= maxLen) return path;
  const parts = path.split("/");
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join("/")}`;
}

/**
 * Render tool input summary.
 */
function ToolInputSummary({ input }: { input: ToolInput }) {
  switch (input.tool) {
    case "bash":
      return (
        <code className="text-emerald-300 text-xs font-mono break-all">
          {input.command.slice(0, 100)}
          {input.command.length > 100 && "..."}
        </code>
      );
    case "read":
      return <span className="text-blue-300 text-xs">{formatPath(input.file_path)}</span>;
    case "write":
      return <span className="text-amber-300 text-xs">{formatPath(input.file_path)}</span>;
    case "edit":
      return <span className="text-purple-300 text-xs">{formatPath(input.file_path)}</span>;
    case "glob":
      return <span className="text-cyan-300 text-xs">{input.pattern}</span>;
    case "grep":
      return <span className="text-cyan-300 text-xs">{input.pattern}</span>;
    case "task":
      return <span className="text-pink-300 text-xs">{input.description}</span>;
    case "todo_write":
      return <TodoDisplay todos={input.todos} />;
    case "ork":
      return <OrkActionDisplay action={input.ork_action} />;
    case "other":
      return <span className="text-gray-400 text-xs">{input.summary}</span>;
    default:
      return null;
  }
}

/**
 * Display todo items.
 */
function TodoDisplay({ todos }: { todos: TodoItem[] }) {
  return (
    <div className="text-xs space-y-0.5">
      {todos.map((todo, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              todo.status === "completed"
                ? "bg-green-400"
                : todo.status === "in_progress"
                  ? "bg-blue-400"
                  : "bg-gray-400"
            }`}
          />
          <span className="text-gray-300">{todo.content}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Display ork CLI action.
 */
function OrkActionDisplay({ action }: { action: OrkAction }) {
  const getActionText = () => {
    switch (action.action) {
      case "complete":
        return `Complete ${action.task_id}${action.summary ? `: ${action.summary}` : ""}`;
      case "fail":
        return `Fail ${action.task_id}${action.reason ? `: ${action.reason}` : ""}`;
      case "block":
        return `Block ${action.task_id}${action.reason ? `: ${action.reason}` : ""}`;
      case "approve":
        return `Approve ${action.task_id}`;
      case "set_plan":
        return `Set plan for ${action.task_id}`;
      case "approve_review":
        return `Approve review ${action.task_id}`;
      case "reject_review":
        return `Reject review ${action.task_id}${action.feedback ? `: ${action.feedback}` : ""}`;
      case "create_subtask":
        return `Create subtask: ${action.title}`;
      case "set_breakdown":
        return `Set breakdown for ${action.task_id}`;
      case "approve_breakdown":
        return `Approve breakdown ${action.task_id}`;
      case "skip_breakdown":
        return `Skip breakdown ${action.task_id}`;
      case "complete_subtask":
        return `Complete subtask ${action.subtask_id}`;
      case "other":
        return action.raw;
      default:
        return "Unknown action";
    }
  };

  return <span className="text-orange-300 text-xs">{getActionText()}</span>;
}

/**
 * Expandable tool result content.
 */
function ToolResultContent({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > 200;

  return (
    <div className="mt-1 ml-6 text-xs text-gray-400 font-mono whitespace-pre-wrap break-words">
      {expanded || !isLong ? content : `${content.slice(0, 200)}...`}
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="ml-2 text-blue-400 hover:text-blue-300 underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/**
 * Main component for rendering a single log entry.
 */
export function LogEntryView({ entry }: { entry: LogEntry }) {
  switch (entry.type) {
    case "text":
      return <div className="py-1 text-gray-100 text-sm whitespace-pre-wrap">{entry.content}</div>;

    case "user_message": {
      // Determine styling based on resume_type
      const resumeType: ResumeType = entry.resume_type ?? "continue";
      const resumeStyles: Record<
        ResumeType,
        { label: string; textColor: string; bgColor: string; borderColor: string }
      > = {
        continue: {
          label: "Session Resumed",
          textColor: "text-blue-400",
          bgColor: "bg-blue-900/30",
          borderColor: "border-blue-500",
        },
        feedback: {
          label: "Feedback Requested",
          textColor: "text-amber-400",
          bgColor: "bg-amber-900/30",
          borderColor: "border-amber-500",
        },
        integration: {
          label: "Integration Conflict",
          textColor: "text-red-400",
          bgColor: "bg-red-900/30",
          borderColor: "border-red-500",
        },
        answers: {
          label: "Questions Answered",
          textColor: "text-green-400",
          bgColor: "bg-green-900/30",
          borderColor: "border-green-500",
        },
      };
      const style = resumeStyles[resumeType] ?? resumeStyles.continue;

      return (
        <div className="py-3 my-4">
          {/* Iteration separator */}
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1 h-px bg-gray-600" />
            <span className={`text-xs ${style.textColor} font-medium uppercase tracking-wider`}>
              {style.label}
            </span>
            <div className="flex-1 h-px bg-gray-600" />
          </div>
          {/* Resumption context */}
          <div className={`px-3 py-2 ${style.bgColor} border-l-2 ${style.borderColor} rounded-r`}>
            <div className="text-gray-200 text-sm">{entry.content}</div>
          </div>
        </div>
      );
    }

    case "tool_use":
      return (
        <div className="py-1.5 flex items-start gap-2">
          <span
            className={`flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-white ${getToolColor(entry.tool)}`}
          >
            {getToolIcon(entry.tool, 14)}
          </span>
          <div className="flex-1 min-w-0">
            <ToolInputSummary input={entry.input} />
          </div>
        </div>
      );

    case "tool_result":
      // Only show Task results (subagent output)
      if (entry.tool === "Task") {
        return (
          <div className="py-1.5 ml-6 border-l-2 border-pink-600/50 pl-2">
            <div className="text-xs text-pink-400 mb-1">Subagent result:</div>
            <ToolResultContent content={entry.content} />
          </div>
        );
      }
      return null;

    case "subagent_tool_use":
      return (
        <div className="py-1 ml-6 flex items-start gap-2 opacity-75">
          <span
            className={`flex-shrink-0 w-4 h-4 rounded flex items-center justify-center text-white ${getToolColor(entry.tool)}`}
          >
            {getToolIcon(entry.tool, 12)}
          </span>
          <div className="flex-1 min-w-0">
            <ToolInputSummary input={entry.input} />
          </div>
        </div>
      );

    case "subagent_tool_result":
      // Skip most subagent results, they're verbose
      return null;

    case "process_exit":
      return (
        <div className="py-2 my-2 text-center text-gray-500 text-xs border-t border-gray-700">
          Process exited{entry.code !== undefined ? ` (code ${entry.code})` : ""}
        </div>
      );

    case "error":
      return (
        <div className="py-2 px-3 my-2 bg-red-900/30 border-l-2 border-red-500 rounded-r">
          <div className="text-xs text-red-400 mb-1">Error</div>
          <div className="text-red-300 text-sm">{entry.message}</div>
        </div>
      );

    default:
      return null;
  }
}

/**
 * Log list component with auto-scroll.
 */
export function LogList({
  logs,
  isLoading,
  error,
}: {
  logs: LogEntry[];
  isLoading?: boolean;
  error?: string | null;
}) {
  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {error}
        </div>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        {isLoading ? (
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
            Loading logs...
          </div>
        ) : (
          "No log entries yet. Agent activity will appear here."
        )}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {logs.map((entry, i) => (
        <LogEntryView key={i} entry={entry} />
      ))}
    </div>
  );
}
