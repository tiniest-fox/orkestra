// Shared conversation-style message list for AssistantDrawer, InteractiveDrawer, and Logs tab.

import ReactMarkdown from "react-markdown";
import type { LogEntry } from "../../types/workflow";
import { stripQuestionBlocks } from "../../utils/assistantQuestions";
import { stripParameterBlocks } from "../../utils/feedContent";
import { PROSE_CLASSES } from "../../utils/prose";
import { toolSummary } from "../../utils/toolSummary";
import type { GroupedLogEntry } from "../Logs/useGroupedLogs";
import { useGroupedLogs } from "../Logs/useGroupedLogs";
import { richContentComponents, richContentPlugins } from "../ui/RichContent";
import { ErrorLine, ScriptOutputLine, ToolLine } from "./FeedEntryComponents";

// ============================================================================
// Types
// ============================================================================

export interface UserMessage {
  kind: "user";
  content: string;
}

export interface AgentMessage {
  kind: "agent";
  entries: LogEntry[];
}

export type DisplayMessage = UserMessage | AgentMessage;

export function buildDisplayMessages(logs: LogEntry[]): DisplayMessage[] {
  const messages: DisplayMessage[] = [];
  let agentEntries: LogEntry[] = [];

  for (const entry of logs) {
    if (entry.type === "user_message") {
      if (agentEntries.length > 0) {
        messages.push({ kind: "agent", entries: agentEntries });
        agentEntries = [];
      }
      messages.push({ kind: "user", content: entry.content });
    } else {
      agentEntries.push(entry);
    }
  }

  if (agentEntries.length > 0) {
    messages.push({ kind: "agent", entries: agentEntries });
  }

  return messages;
}

// ============================================================================
// Entry components
// ============================================================================

function AssistantTextLine({ content }: { content: string }) {
  const cleaned = stripQuestionBlocks(stripParameterBlocks(content));
  if (!cleaned) return null;
  return (
    <div className={`text-forge-body py-3 ${PROSE_CLASSES}`}>
      <ReactMarkdown remarkPlugins={richContentPlugins} components={richContentComponents}>
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}

export function AgentEntry({ entry }: { entry: GroupedLogEntry }) {
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
      return <AssistantTextLine content={entry.content} />;

    case "tool_use":
      return <ToolLine label={entry.tool} summary={toolSummary(entry.input)} variant="tool" />;

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

    case "user_message":
    case "tool_result":
    case "subagent_tool_use":
    case "subagent_tool_result":
    case "process_exit":
      return null;

    default:
      return null;
  }
}

// ============================================================================
// AgentEntries (private)
// ============================================================================

function AgentEntries({ entries }: { entries: LogEntry[] }) {
  const grouped = useGroupedLogs(entries);
  return (
    <>
      {grouped.map((entry, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: no stable IDs on log entries
        <AgentEntry key={i} entry={entry} />
      ))}
    </>
  );
}

// ============================================================================
// MessageList
// ============================================================================

export interface MessageListProps {
  messages: DisplayMessage[];
  isAgentRunning: boolean;
  /** Label shown on agent message blocks. Defaults to "Agent". */
  agentLabel?: string;
  /** Label shown on user message blocks. Defaults to "You". */
  userLabel?: string;
  /** Transforms user message content before rendering. Defaults to identity. */
  contentFilter?: (content: string) => string;
  /** Content rendered below the last agent message block (e.g. question cards). */
  lastAgentExtra?: React.ReactNode;
  /** Text shown when there are no messages and the agent is not running. */
  emptyText?: string;
  containerRef: React.Ref<HTMLDivElement>;
  onScroll: React.UIEventHandler<HTMLDivElement>;
}

export function MessageList({
  messages,
  isAgentRunning,
  agentLabel = "Agent",
  userLabel = "You",
  contentFilter,
  lastAgentExtra,
  emptyText = "No messages yet.",
  containerRef,
  onScroll,
}: MessageListProps) {
  return (
    <div ref={containerRef} onScroll={onScroll} className="flex-1 overflow-y-auto bg-canvas">
      {messages.length === 0 && !isAgentRunning && (
        <div className="flex items-center justify-center h-full">
          <p className="font-mono text-forge-mono-sm text-text-quaternary">{emptyText}</p>
        </div>
      )}
      {messages.map((msg, i) => {
        const isLastAgent =
          msg.kind === "agent" && messages.slice(i + 1).every((m) => m.kind !== "agent");

        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: display messages have no stable IDs
            key={`msg-${i}`}
            className={[
              "border-b border-border last:border-b-0",
              msg.kind === "user"
                ? "border-l-2 border-l-accent bg-surface px-6 py-3.5 pl-[22px]"
                : "bg-canvas px-6 py-3.5",
            ].join(" ")}
          >
            <div
              className={[
                "font-mono text-forge-mono-label font-medium uppercase tracking-wider mb-1.5",
                msg.kind === "user" ? "text-accent" : "text-text-tertiary",
              ].join(" ")}
            >
              {msg.kind === "user" ? userLabel : agentLabel}
            </div>
            {msg.kind === "agent" ? (
              <div className="text-text-secondary">
                <AgentEntries entries={msg.entries} />
              </div>
            ) : (
              <div className="font-sans text-forge-body text-text-secondary leading-relaxed whitespace-pre-wrap">
                {contentFilter ? contentFilter(msg.content) : msg.content}
              </div>
            )}

            {isLastAgent && lastAgentExtra && <>{lastAgentExtra}</>}
          </div>
        );
      })}

      {isAgentRunning && (
        <div className="flex items-center gap-2 px-6 py-3.5 text-text-quaternary">
          <span className="w-3.5 h-3.5 border-2 border-border border-t-transparent rounded-full animate-spin shrink-0" />
          <span className="font-mono text-forge-mono-sm">Working…</span>
        </div>
      )}
    </div>
  );
}
