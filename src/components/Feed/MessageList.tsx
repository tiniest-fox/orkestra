// Shared conversation-style message list for AssistantDrawer, InteractiveDrawer, and Logs tab.

import ReactMarkdown from "react-markdown";
import type { LogEntry, ResumeType, WorkflowArtifact } from "../../types/workflow";
import { stripQuestionBlocks } from "../../utils/assistantQuestions";
import { stripParameterBlocks } from "../../utils/feedContent";
import { PROSE_CLASSES } from "../../utils/prose";
import { toolSummary } from "../../utils/toolSummary";
import type { GroupedLogEntry } from "../Logs/useGroupedLogs";
import { useGroupedLogs } from "../Logs/useGroupedLogs";
import { richContentComponents, richContentPlugins } from "../ui/RichContent";
import { ArtifactLogCard } from "./ArtifactLogCard";
import { ErrorLine, ScriptOutputLine, ToolLine } from "./FeedEntryComponents";

// ============================================================================
// Types
// ============================================================================

export interface UserMessage {
  kind: "user";
  content: string;
  resumeType?: ResumeType;
}

/** Label and visual style for a user message block. */
export type UserClassification = { label: string; isHuman: boolean };

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
      const userMsg: UserMessage = { kind: "user", content: entry.content };
      if (entry.resume_type !== undefined) {
        userMsg.resumeType = entry.resume_type;
      }
      messages.push(userMsg);
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

export function AgentEntry({
  entry,
  projectRoot,
  artifacts,
}: {
  entry: GroupedLogEntry;
  projectRoot?: string;
  artifacts?: Record<string, WorkflowArtifact>;
}) {
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
          {shown.map((sub, i) => {
            if (sub.type !== "subagent_tool_use") return null;
            const summary = toolSummary(sub.input, projectRoot);
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: no stable ID
              <ToolLine key={i} label={sub.tool} summary={summary} variant="tool" />
            );
          })}
        </div>
      </>
    );
  }

  switch (entry.type) {
    case "text":
      return <AssistantTextLine content={entry.content} />;

    case "tool_use":
      return (
        <ToolLine
          label={entry.tool}
          summary={toolSummary(entry.input, projectRoot)}
          variant="tool"
        />
      );

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

    case "artifact_produced": {
      const artifact = artifacts?.[entry.name];
      if (!artifact) return null;
      return <ArtifactLogCard artifact={artifact} />;
    }

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

function AgentEntries({
  entries,
  projectRoot,
  artifacts,
}: {
  entries: LogEntry[];
  projectRoot?: string;
  artifacts?: Record<string, WorkflowArtifact>;
}) {
  const grouped = useGroupedLogs(entries);
  return (
    <>
      {grouped.map((entry, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: no stable IDs on log entries
        <AgentEntry key={i} entry={entry} projectRoot={projectRoot} artifacts={artifacts} />
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
  /** Absolute path to the project root — threaded to toolSummary for path relativization. */
  projectRoot?: string;
  /** Artifact map from the task — used to look up artifact content for artifact_produced entries. */
  artifacts?: Record<string, WorkflowArtifact>;
  /** Label shown on agent message blocks. Defaults to "Agent". */
  agentLabel?: string;
  /** Label shown on user message blocks when classifyUser is not provided. Defaults to "You". */
  userLabel?: string;
  /** Per-message classification for user messages — provides label and accent style. */
  classifyUser?: (msg: UserMessage) => UserClassification;
  /** Transforms user message content before rendering. Defaults to identity. */
  contentFilter?: (content: string) => string;
  /** Content rendered below the last agent message block (e.g. question cards). */
  lastAgentExtra?: React.ReactNode;
  /** Text shown when there are no messages and the agent is not running. */
  emptyText?: string;
  /** When provided, MessageList is the scroll container (adds flex-1 overflow-y-auto). */
  containerRef?: React.Ref<HTMLDivElement>;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
}

export function MessageList({
  messages,
  isAgentRunning,
  projectRoot,
  artifacts,
  agentLabel = "Agent",
  userLabel = "You",
  classifyUser,
  contentFilter,
  lastAgentExtra,
  emptyText = "No messages yet.",
  containerRef,
  onScroll,
}: MessageListProps) {
  const isScrollContainer = containerRef != null;

  let lastAgentIndex = -1;
  for (let j = messages.length - 1; j >= 0; j--) {
    if (messages[j].kind === "agent") {
      lastAgentIndex = j;
      break;
    }
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className={isScrollContainer ? "flex-1 overflow-y-auto bg-canvas" : ""}
    >
      {messages.length === 0 && !isAgentRunning && (
        <div className="flex items-center justify-center h-full">
          <p className="font-mono text-forge-mono-sm text-text-quaternary">{emptyText}</p>
        </div>
      )}
      {messages.map((msg, i) => {
        const isLastAgent = i === lastAgentIndex;

        const classification = msg.kind === "user" && classifyUser ? classifyUser(msg) : null;
        const isHuman = classification ? classification.isHuman : true;
        const msgLabel =
          msg.kind === "user" ? (classification ? classification.label : userLabel) : agentLabel;

        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: display messages have no stable IDs
            key={`msg-${i}`}
            className={[
              "border-b border-border last:border-b-0",
              msg.kind === "user"
                ? isHuman
                  ? "border-l-2 border-l-accent bg-surface px-6 py-3.5 pl-[22px]"
                  : "border-l-2 border-l-border bg-canvas px-6 py-3.5 pl-[22px]"
                : "bg-canvas px-6 py-3.5",
            ].join(" ")}
          >
            <div
              className={[
                "font-mono text-forge-mono-label font-medium uppercase tracking-wider mb-1.5",
                msg.kind === "user" && isHuman ? "text-accent" : "text-text-tertiary",
              ].join(" ")}
            >
              {msgLabel}
            </div>
            {msg.kind === "agent" ? (
              <div className="text-text-secondary">
                <AgentEntries
                  entries={msg.entries}
                  projectRoot={projectRoot}
                  artifacts={artifacts}
                />
              </div>
            ) : (
              <div className={`text-forge-body text-text-secondary ${PROSE_CLASSES}`}>
                <ReactMarkdown
                  remarkPlugins={richContentPlugins}
                  components={richContentComponents}
                >
                  {contentFilter ? contentFilter(msg.content) : msg.content}
                </ReactMarkdown>
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
