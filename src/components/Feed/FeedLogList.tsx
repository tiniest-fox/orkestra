//! Feed log list — Forge-styled activity log for FocusDrawer and ReviewDrawer.
//!
//! A variant of LogList tuned for the Feed's compact, monospaced aesthetic.
//! Tool calls are compact one-liners; thinking is subtle prose; user messages
//! are minimal dividers. All colours use Forge CSS custom properties.

import { Terminal } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { EmptyState, ErrorState } from "../ui";
import { useGroupedLogs } from "../Logs/useGroupedLogs";
import type { GroupedLogEntry } from "../Logs/useGroupedLogs";
import type { LogEntry, OrkAction, ResumeType, ToolInput } from "../../types/workflow";
import { formatPath } from "../../utils/formatters";
import { FORGE_PROSE } from "../../utils/prose";

// ============================================================================
// Public component
// ============================================================================

interface FeedLogListProps {
  logs: LogEntry[];
  error?: unknown;
}

export function FeedLogList({ logs, error }: FeedLogListProps) {
  const grouped = useGroupedLogs(logs);

  if (error != null) {
    return (
      <div className="flex items-center justify-center h-full">
        <ErrorState message="Failed to load logs" error={error} />
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <EmptyState icon={Terminal} message="No activity yet." description="Agent output will appear here." />
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {grouped.map((entry, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: log entries have no stable IDs
        <FeedEntry key={i} entry={entry} />
      ))}
    </div>
  );
}

// ============================================================================
// Entry dispatcher
// ============================================================================

function FeedEntry({ entry }: { entry: GroupedLogEntry }) {
  if (entry.type === "subagent_group") {
    const toolCalls = entry.subagentEntries.filter((s) => s.type === "subagent_tool_use");
    const shown = toolCalls.slice(-2);
    const hidden = toolCalls.length - shown.length;
    return (
      <>
        <ToolLine label="Task" summary={entry.taskEntry.input.tool === "task" ? (entry.taskEntry.input as { description?: string }).description ?? "" : ""} variant="task" />
        <div className="ml-[2px] pl-4 border-l border-[var(--border)]">
          {hidden > 0 && (
            <div className="font-forge-mono text-forge-mono-sm text-[var(--text-3)] py-[3px]">
              +{hidden} tool call{hidden !== 1 ? "s" : ""}
            </div>
          )}
          {shown.map((sub, i) =>
            sub.type === "subagent_tool_use" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: no stable ID
              <ToolLine key={i} label={sub.tool} summary={toolSummary(sub.input)} variant="tool" />
            ) : null
          )}
        </div>
      </>
    );
  }

  switch (entry.type) {
    case "text":
      return <ThinkingLine content={entry.content} />;

    case "user_message":
      return <UserBubble content={entry.content} resumeType={entry.resume_type} />;

    case "tool_use":
      return <ToolLine label={entry.tool} summary={toolSummary(entry.input)} variant="tool" />;

    case "tool_result":
    case "subagent_tool_result":
    case "subagent_tool_use":
    case "process_exit":
      return null;

    case "error":
      return <ErrorLine message={entry.message} />;

    case "script_start":
      return <ToolLine label={`sh · ${entry.stage}`} summary={entry.command} variant="script" />;

    case "script_output":
      return <ScriptOutputLine content={entry.content} />;

    case "script_exit":
      return (
        <div className={`font-forge-mono text-forge-mono-sm py-0.5 ${entry.success ? "text-[var(--text-3)]" : "text-[var(--red)]"}`}>
          {entry.success ? "✓ done" : `✗ exit ${entry.code}${entry.timed_out ? " (timed out)" : ""}`}
        </div>
      );

    default:
      return null;
  }
}

// ============================================================================
// Entry components
// ============================================================================


const TOOL_VARIANTS = {
  tool:   "text-[var(--text-2)]",
  task:   "text-[var(--accent)]",
  script: "text-[var(--text-2)]",
} as const;

function ToolLine({ label, summary, variant }: { label: string; summary: string; variant: keyof typeof TOOL_VARIANTS }) {
  return (
    <div className="flex items-baseline gap-2 py-1">
      <span className={`font-forge-mono text-forge-mono-sm font-medium shrink-0 ${TOOL_VARIANTS[variant]}`}>
        {label}
      </span>
      {summary && (
        <span className="font-forge-mono text-forge-mono-sm text-[var(--text-3)] truncate min-w-0">
          {summary}
        </span>
      )}
    </div>
  );
}

function ThinkingLine({ content }: { content: string }) {
  const cleaned = content.replace(/<parameter name="content">[\s\S]*?<\/antml:parameter>/g, "").trim();
  if (!cleaned) return null;
  return (
    <div className={`text-forge-body py-3 ${FORGE_PROSE}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleaned}</ReactMarkdown>
    </div>
  );
}


// Bubble style groups — color communicates type, no label needed.
// human:  direct human input (feedback, answers, manual resume) — warm accent tint
// system: automatic continuations — neutral, nearly invisible
// initial: the very first prompt — purple tint, distinctly one-of-a-kind
type BubbleGroup = "human" | "system" | "initial";

const RESUME_GROUP: Record<ResumeType, BubbleGroup> = {
  initial:       "initial",
  feedback:      "human",
  answers:       "human",
  manual_resume: "human",
  continue:      "system",
  recheck:       "system",
  retry_failed:  "system",
  retry_blocked: "system",
  integration:   "system",
};

const BUBBLE_STYLES: Record<BubbleGroup, string> = {
  human:   "bg-[var(--bubble-human-bg)]   border border-[var(--bubble-human-border)]",
  initial: "bg-[var(--bubble-initial-bg)] border border-[var(--bubble-initial-border)]",
  system:  "bg-[var(--surface-2)]         border border-[var(--border)]",
};

function UserBubble({ content, resumeType }: { content: string; resumeType?: ResumeType }) {
  const group: BubbleGroup = resumeType ? RESUME_GROUP[resumeType] : "system";
  return (
    <div className="flex justify-end py-3">
      <div className={`max-w-[85%] rounded-lg px-3 py-2 ${BUBBLE_STYLES[group]}`}>
        <div className={`text-forge-body text-[var(--text-0)] ${FORGE_PROSE}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <div className="font-forge-mono text-forge-mono-sm text-[var(--red)] py-2 border-l-2 border-[var(--red)] pl-2 my-2">
      {message}
    </div>
  );
}

function ScriptOutputLine({ content }: { content: string }) {
  const trimmed = content.trimEnd();
  if (!trimmed) return null;
  return (
    <div className="font-forge-mono text-forge-mono-sm text-[var(--text-2)] py-[2px] whitespace-pre-wrap">
      {trimmed}
    </div>
  );
}

// ============================================================================
// Tool input summary — plain text, Forge tokens
// ============================================================================

function toolSummary(input: ToolInput): string {
  switch (input.tool) {
    case "bash":       return input.command.slice(0, 120);
    case "read":       return formatPath(input.file_path);
    case "write":      return formatPath(input.file_path);
    case "edit":       return formatPath(input.file_path);
    case "glob":       return input.pattern;
    case "grep":       return input.pattern;
    case "task":       return input.description ?? "";
    case "web_search": return input.query;
    case "web_fetch":  return input.url;
    case "todo_write": return `${input.todos.length} item${input.todos.length !== 1 ? "s" : ""}`;
    case "ork":        return orkSummary(input.ork_action);
    case "structured_output": return input.output_type ?? "";
    case "other":      return input.summary ?? "";
    default:           return "";
  }
}

function orkSummary(action: OrkAction): string {
  switch (action.action) {
    case "complete":        return `complete ${action.task_id}`;
    case "fail":            return `fail ${action.task_id}`;
    case "block":           return `block ${action.task_id}`;
    case "approve":         return `approve ${action.task_id}`;
    case "create_subtask":  return action.title ?? "";
    default:                return action.action;
  }
}
