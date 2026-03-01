//! Feed log list — Forge-styled activity log for FocusDrawer and ReviewDrawer.
//!
//! A variant of LogList tuned for the Feed's compact, monospaced aesthetic.
//! Tool calls are compact one-liners; thinking is subtle prose; user messages
//! are minimal dividers. All colours use Forge design system Tailwind tokens.

import { Terminal } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { LogEntry, ResumeType } from "../../types/workflow";
import { PROSE_CLASSES } from "../../utils/prose";
import { toolSummary } from "../../utils/toolSummary";
import type { GroupedLogEntry } from "../Logs/useGroupedLogs";
import { useGroupedLogs } from "../Logs/useGroupedLogs";
import { EmptyState, ErrorState } from "../ui";

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
        <EmptyState
          icon={Terminal}
          message="No activity yet."
          description="Agent output will appear here."
        />
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
        <ToolLine
          label="Agent"
          summary={
            entry.taskEntry.input.tool === "agent"
              ? ((entry.taskEntry.input as { description?: string }).description ?? "")
              : ""
          }
          variant="task"
        />
        <div className="ml-[2px] pl-4 border-l border-border">
          {hidden > 0 && (
            <div className="font-mono text-forge-mono-sm text-text-quaternary py-[3px]">
              +{hidden} tool call{hidden !== 1 ? "s" : ""}
            </div>
          )}
          {shown.map((sub, i) =>
            sub.type === "subagent_tool_use" ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: no stable ID
              <ToolLine key={i} label={sub.tool} summary={toolSummary(sub.input)} variant="tool" />
            ) : null,
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
        <div
          className={`font-mono text-forge-mono-sm py-0.5 ${entry.success ? "text-text-quaternary" : "text-status-error"}`}
        >
          {entry.success
            ? "✓ done"
            : `✗ exit ${entry.code}${entry.timed_out ? " (timed out)" : ""}`}
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
  tool: "text-text-tertiary",
  task: "text-accent",
  script: "text-text-tertiary",
} as const;

function ToolLine({
  label,
  summary,
  variant,
}: {
  label: string;
  summary: string;
  variant: keyof typeof TOOL_VARIANTS;
}) {
  return (
    <div className="flex items-baseline gap-2 py-1">
      <span
        className={`font-mono text-forge-mono-sm font-medium shrink-0 ${TOOL_VARIANTS[variant]}`}
      >
        {label}
      </span>
      {summary && (
        <span className="font-mono text-forge-mono-sm text-text-quaternary truncate min-w-0">
          {summary}
        </span>
      )}
    </div>
  );
}

function ThinkingLine({ content }: { content: string }) {
  const cleaned = content
    .replace(/<parameter name="content">[\s\S]*?<\/antml:parameter>/g, "")
    .trim();
  if (!cleaned) return null;
  return (
    <div className={`text-forge-body py-3 ${PROSE_CLASSES}`}>
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
  initial: "initial",
  feedback: "human",
  answers: "human",
  manual_resume: "human",
  continue: "system",
  recheck: "system",
  retry_failed: "system",
  retry_blocked: "system",
  integration: "system",
};

const BUBBLE_STYLES: Record<BubbleGroup, string> = {
  human: "bg-accent-soft border border-accent",
  initial: "bg-status-purple-bg border border-status-purple",
  system: "bg-canvas border border-border",
};

function UserBubble({ content, resumeType }: { content: string; resumeType?: ResumeType }) {
  const group: BubbleGroup = resumeType ? RESUME_GROUP[resumeType] : "system";
  return (
    <div className="flex justify-end py-3">
      <div className={`max-w-[85%] rounded-lg px-3 py-2 ${BUBBLE_STYLES[group]}`}>
        <div className={`text-forge-body text-text-primary ${PROSE_CLASSES}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <div className="font-mono text-forge-mono-sm text-status-error py-2 border-l-2 border-status-error pl-2 my-2">
      {message}
    </div>
  );
}

function ScriptOutputLine({ content }: { content: string }) {
  const trimmed = content.trimEnd();
  if (!trimmed) return null;
  return (
    <div className="font-mono text-forge-mono-sm text-text-tertiary py-[2px] whitespace-pre-wrap">
      {trimmed}
    </div>
  );
}
