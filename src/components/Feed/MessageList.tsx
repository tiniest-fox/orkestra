// Shared conversation-style message list for AssistantDrawer, InteractiveDrawer, and Logs tab.

import { memo, useCallback, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { Virtualizer } from "virtua";
import type { LogEntry, ResumeType, WorkflowArtifact } from "../../types/workflow";
import { stripQuestionBlocks } from "../../utils/assistantQuestions";
import { stripParameterBlocks } from "../../utils/feedContent";
import { PROSE_CLASSES } from "../../utils/prose";
import { toolSummary } from "../../utils/toolSummary";
import type { GroupedLogEntry } from "../Logs/useGroupedLogs";
import { groupLogEntries } from "../Logs/useGroupedLogs";
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
// VirtualItem type
// ============================================================================

type VirtualItem =
  | { kind: "user-block"; msg: UserMessage; label: string; isHuman: boolean; isBlockEnd: boolean }
  | { kind: "agent-header"; label: string }
  | {
      kind: "agent-entry";
      entry: GroupedLogEntry;
      projectRoot?: string;
      artifacts?: Record<string, WorkflowArtifact>;
      isBlockEnd: boolean;
    }
  | { kind: "extra"; content: React.ReactNode }
  | { kind: "spinner" };

// ============================================================================
// buildVirtualItems
// ============================================================================

export function buildVirtualItems(
  messages: DisplayMessage[],
  opts: {
    agentLabel: string;
    userLabel: string;
    classifyUser?: (msg: UserMessage) => UserClassification;
    projectRoot?: string;
    artifacts?: Record<string, WorkflowArtifact>;
    isAgentRunning: boolean;
    lastAgentExtra?: React.ReactNode;
  },
): VirtualItem[] {
  const items: VirtualItem[] = [];
  let lastAgentBlockEndIndex = -1;

  for (const msg of messages) {
    if (msg.kind === "user") {
      const classification = opts.classifyUser ? opts.classifyUser(msg) : null;
      const isHuman = classification ? classification.isHuman : true;
      const label = classification ? classification.label : opts.userLabel;
      items.push({ kind: "user-block", msg, label, isHuman, isBlockEnd: true });
    } else {
      // Agent message: header + individual entries
      items.push({ kind: "agent-header", label: opts.agentLabel });
      const grouped = groupLogEntries(msg.entries);
      for (let j = 0; j < grouped.length; j++) {
        const isLast = j === grouped.length - 1;
        items.push({
          kind: "agent-entry",
          entry: grouped[j],
          projectRoot: opts.projectRoot,
          artifacts: opts.artifacts,
          isBlockEnd: isLast,
        });
      }
      lastAgentBlockEndIndex = items.length - 1;
    }
  }

  // Suppress border on the final block (matches old last:border-b-0 behavior)
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if ((item.kind === "user-block" || item.kind === "agent-entry") && item.isBlockEnd) {
      items[i] = { ...item, isBlockEnd: false };
      break;
    }
  }

  // Append lastAgentExtra after the last agent block
  if (opts.lastAgentExtra && lastAgentBlockEndIndex >= 0) {
    items.push({ kind: "extra", content: opts.lastAgentExtra });
  }

  // Append spinner
  if (opts.isAgentRunning) {
    items.push({ kind: "spinner" });
  }

  return items;
}

// ============================================================================
// Entry components
// ============================================================================

const AssistantTextLine = memo(function AssistantTextLine({ content }: { content: string }) {
  const cleaned = stripQuestionBlocks(stripParameterBlocks(content));
  if (!cleaned) return null;
  return (
    <div className={`text-forge-body py-3 ${PROSE_CLASSES}`}>
      <ReactMarkdown remarkPlugins={richContentPlugins} components={richContentComponents}>
        {cleaned}
      </ReactMarkdown>
    </div>
  );
});

export const AgentEntry = memo(function AgentEntry({
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
});

// ============================================================================
// VirtualItemRenderer
// ============================================================================

const VirtualItemRenderer = memo(function VirtualItemRenderer({
  item,
  contentFilter,
}: {
  item: VirtualItem;
  contentFilter?: (content: string) => string;
}) {
  switch (item.kind) {
    case "user-block": {
      const borderClass = item.isHuman
        ? "border-l-2 border-l-accent bg-surface"
        : "border-l-2 border-l-border bg-canvas";
      return (
        <div
          className={`${borderClass} px-6 py-3.5 pl-[22px] ${item.isBlockEnd ? "border-b border-border" : ""}`}
        >
          <div
            className={`font-mono text-forge-mono-label font-medium uppercase tracking-wider mb-1.5 ${item.isHuman ? "text-accent" : "text-text-tertiary"}`}
          >
            {item.label}
          </div>
          <div className={`text-forge-body text-text-secondary ${PROSE_CLASSES}`}>
            <ReactMarkdown remarkPlugins={richContentPlugins} components={richContentComponents}>
              {contentFilter ? contentFilter(item.msg.content) : item.msg.content}
            </ReactMarkdown>
          </div>
        </div>
      );
    }
    case "agent-header":
      return (
        <div className="bg-canvas px-6 pt-3.5">
          <div className="font-mono text-forge-mono-label font-medium uppercase tracking-wider mb-1.5 text-text-tertiary">
            {item.label}
          </div>
        </div>
      );
    case "agent-entry":
      return (
        <div
          className={`bg-canvas px-6 text-text-secondary ${item.isBlockEnd ? "pb-3.5 border-b border-border" : ""}`}
        >
          <AgentEntry
            entry={item.entry}
            projectRoot={item.projectRoot}
            artifacts={item.artifacts}
          />
        </div>
      );
    case "extra":
      return <div className="bg-canvas px-6 pb-3.5">{item.content}</div>;
    case "spinner":
      return (
        <div className="flex items-center gap-2 px-6 py-3.5 text-text-quaternary">
          <span className="w-3.5 h-3.5 border-2 border-border border-t-transparent rounded-full animate-spin shrink-0" />
          <span className="font-mono text-forge-mono-sm">Working…</span>
        </div>
      );
  }
});

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
  const useVirtualization = containerRef != null;

  // Flatten messages into virtual items (memoized)
  const virtualItems = useMemo(
    () =>
      buildVirtualItems(messages, {
        agentLabel,
        userLabel,
        classifyUser,
        projectRoot,
        artifacts,
        isAgentRunning,
        lastAgentExtra,
      }),
    [
      messages,
      agentLabel,
      userLabel,
      classifyUser,
      projectRoot,
      artifacts,
      isAgentRunning,
      lastAgentExtra,
    ],
  );

  // Object ref for Virtualizer's scrollRef prop
  const scrollObjectRef = useRef<HTMLDivElement | null>(null);

  // Merge callback ref (from useAutoScroll) with object ref (for Virtualizer)
  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollObjectRef.current = node;
      if (typeof containerRef === "function") {
        containerRef(node);
      } else if (containerRef && typeof containerRef === "object") {
        (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [containerRef],
  );

  if (useVirtualization) {
    return (
      <div ref={mergedRef} onScroll={onScroll} className="flex-1 overflow-y-auto bg-canvas">
        {virtualItems.length === 0 && !isAgentRunning ? (
          <div className="flex items-center justify-center h-full">
            <p className="font-mono text-forge-mono-sm text-text-quaternary">{emptyText}</p>
          </div>
        ) : (
          <Virtualizer scrollRef={scrollObjectRef}>
            {virtualItems.map((item, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only list, no reordering
              <VirtualItemRenderer key={i} item={item} contentFilter={contentFilter} />
            ))}
          </Virtualizer>
        )}
      </div>
    );
  }

  // Non-virtualized fallback (HistoricalRunView — no containerRef)
  return (
    <div className="bg-canvas">
      {virtualItems.length === 0 && !isAgentRunning ? (
        <div className="flex items-center justify-center h-full">
          <p className="font-mono text-forge-mono-sm text-text-quaternary">{emptyText}</p>
        </div>
      ) : (
        virtualItems.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
          <VirtualItemRenderer key={i} item={item} contentFilter={contentFilter} />
        ))
      )}
    </div>
  );
}
