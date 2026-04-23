// Shared conversation-style message list for AssistantDrawer and Logs tab.

import DOMPurify from "dompurify";
import { ChevronDown, ChevronUp, Shield, ShieldCheck, ShieldX } from "lucide-react";
import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeStringify from "rehype-stringify";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import type { CustomItemComponentProps, VirtualizerHandle } from "virtua";
import { Virtualizer } from "virtua";
import { useIsMobile } from "../../hooks/useIsMobile";
import type {
  LogEntry,
  ResumeType,
  WorkflowArtifact,
  WorkflowResource,
} from "../../types/workflow";
import { formatTimestamp } from "../../utils";
import { AnsiText } from "../../utils/ansi";
import { stripQuestionBlocks } from "../../utils/assistantQuestions";
import { stripParameterBlocks } from "../../utils/feedContent";
import { PROSE_CLASSES } from "../../utils/prose";
import { compactGroupSummary, toolSummary } from "../../utils/toolSummary";
import type { GroupedLogEntry } from "../Logs/useGroupedLogs";
import { groupLogEntries } from "../Logs/useGroupedLogs";
import { Button } from "../ui/Button";
import { richContentComponents, richContentPlugins } from "../ui/RichContent";
import { ArtifactLogCard } from "./ArtifactLogCard";
import { ResourceItem } from "./Drawer/Sections/ResourceItem";
import { ErrorLine, ToolLine } from "./FeedEntryComponents";
import { ArtifactBadge } from "./OutcomeBadge";

// ============================================================================
// Markdown HTML cache
// ============================================================================
//
// Virtua unmounts items that scroll out of view and remounts them when they
// scroll back. Without caching, each remount re-runs the full remark/rehype
// parse pipeline — expensive for large blocks (10–36ms).
//
// For plain markdown (no mermaid/wireframe), we render to an HTML string once,
// sanitize with DOMPurify, and cache it at module level. On remount the item
// renders instantly from cache via dangerouslySetInnerHTML.
//
// Entries containing mermaid or wireframe blocks are excluded — those need
// React lifecycle (MermaidBlock, WireframeBlock) and fall back to ReactMarkdown.
//
// Cache is LRU-bounded at MAX_CACHE_ENTRIES. Each entry is a sanitized HTML
// string (~0.5–5KB). At 500 entries the upper bound is ~2.5MB — acceptable
// for a long session, negligible for a typical one.

const MAX_CACHE_ENTRIES = 500;
const markdownHtmlCache = new Map<string, string>();

// Single processor instance — building the unified pipeline is not free.
const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkBreaks)
  .use(remarkRehype)
  .use(rehypeStringify);

function hasRichBlocks(content: string): boolean {
  return content.includes("```mermaid") || content.includes("```wireframe");
}

function renderMarkdownToHtml(content: string): string {
  const cached = markdownHtmlCache.get(content);
  if (cached !== undefined) {
    // Refresh insertion order so this entry is last-evicted.
    markdownHtmlCache.delete(content);
    markdownHtmlCache.set(content, cached);
    return cached;
  }
  const raw = String(markdownProcessor.processSync(content));
  const sanitized = DOMPurify.sanitize(raw);
  if (markdownHtmlCache.size >= MAX_CACHE_ENTRIES) {
    // Map preserves insertion order — first key is least recently used.
    markdownHtmlCache.delete(markdownHtmlCache.keys().next().value as string);
  }
  markdownHtmlCache.set(content, sanitized);
  return sanitized;
}

// ============================================================================
// Types
// ============================================================================

export interface UserMessage {
  kind: "user";
  content: string;
  resumeType?: ResumeType;
  sections?: Array<{ label: string; content: string }>;
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
      if (entry.resume_type === "gate_failure") continue;
      if (agentEntries.length > 0) {
        messages.push({ kind: "agent", entries: agentEntries });
        agentEntries = [];
      }
      const userMsg: UserMessage = { kind: "user", content: entry.content };
      if (entry.resume_type !== undefined) {
        userMsg.resumeType = entry.resume_type;
      }
      if (entry.sections !== undefined && entry.sections.length > 0) {
        userMsg.sections = entry.sections;
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
// ArtifactContext
// ============================================================================

/** Context passed from AgentTab so artifact_produced entries render with actions. */
export interface ArtifactContext {
  /** Actions for the latest regular artifact (approve/reject). */
  actions?: {
    needsReview: boolean;
    verdict?: "approved" | "rejected";
    rejectionTarget?: string;
    onApprove: () => void;
    loading: boolean;
  };
  /** When the latest artifact has pending questions, render this element instead of ArtifactLogCard. */
  questionsElement?: React.ReactNode;
  /** Gate log entries (gate_started + gate_output + gate_completed) that follow the latest artifact. */
  gateEntries?: LogEntry[];
  /** True when gate_started exists but no gate_completed yet. */
  isGateRunning?: boolean;
  /** True when gate_completed with passed=true. */
  gatePassed?: boolean;
}

// ============================================================================
// VirtualItem type
// ============================================================================

type VirtualItem =
  | { kind: "user-block"; msg: UserMessage; label: string; isHuman: boolean; isBlockEnd: boolean }
  | {
      kind: "agent-entry";
      entry: GroupedLogEntry;
      projectRoot?: string;
      artifactContext?: ArtifactContext;
      latestArtifactId?: string;
      taskResources?: Record<string, WorkflowResource>;
      isBlockEnd: boolean;
      gateEntries?: LogEntry[];
    }
  // The latest actionable artifact is split into two items so the sticky header lives in its
  // own Virtua entry, separate from the body. This lets sticky top-0 on the header apply
  // within Virtua's container rather than being constrained by a shared parent div.
  | { kind: "artifact-header"; artifact: WorkflowArtifact; artifactContext: ArtifactContext }
  | {
      kind: "artifact-body";
      artifact: WorkflowArtifact;
      taskResources?: Record<string, WorkflowResource>;
      gateEntries?: LogEntry[];
      isGateRunning?: boolean;
      gatePassed?: boolean;
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
    artifactContext?: ArtifactContext;
    latestArtifactId?: string;
    taskResources?: Record<string, WorkflowResource>;
    isAgentRunning: boolean;
    lastAgentExtra?: React.ReactNode;
  },
): VirtualItem[] {
  const items: VirtualItem[] = [];
  let lastAgentBlockEndIndex = -1;
  let latestArtifactProcessed = false;

  for (const msg of messages) {
    if (msg.kind === "user") {
      const classification = opts.classifyUser ? opts.classifyUser(msg) : null;
      const isHuman = classification ? classification.isHuman : true;
      const label = classification ? classification.label : opts.userLabel;
      items.push({ kind: "user-block", msg, label, isHuman, isBlockEnd: true });
    } else {
      // Agent message: individual entries
      const grouped = groupLogEntries(msg.entries);
      for (let j = 0; j < grouped.length; j++) {
        const isLast = j === grouped.length - 1;
        const entry = grouped[j];

        // Skip gate entries that follow the latest artifact — they're absorbed into the artifact card.
        if (
          latestArtifactProcessed &&
          (entry.type === "gate_started" ||
            entry.type === "gate_output" ||
            entry.type === "gate_completed")
        ) {
          continue;
        }

        // Split the latest actionable artifact into two items so the sticky header
        // is independent of the body in Virtua's item list.
        const artifactContext = opts.artifactContext;
        if (
          entry.type === "artifact_produced" &&
          opts.latestArtifactId !== undefined &&
          entry.artifact_id === opts.latestArtifactId &&
          artifactContext != null &&
          !artifactContext.questionsElement
        ) {
          const artifact = entry.artifact;
          if (artifact) {
            items.push({ kind: "artifact-header", artifact, artifactContext });
            items.push({
              kind: "artifact-body",
              artifact,
              taskResources: opts.taskResources,
              gateEntries: opts.artifactContext?.gateEntries,
              isGateRunning: opts.artifactContext?.isGateRunning,
              gatePassed: opts.artifactContext?.gatePassed,
              isBlockEnd: isLast,
            });
            latestArtifactProcessed = true;
            lastAgentBlockEndIndex = items.length - 1;
            continue;
          }
        }

        // Collect gate entries following a superseded artifact so they render
        // inline inside the artifact card rather than as separate timeline items.
        let supersededGateEntries: LogEntry[] | undefined;
        if (
          entry.type === "artifact_produced" &&
          entry.artifact &&
          opts.latestArtifactId !== undefined &&
          entry.artifact_id !== opts.latestArtifactId
        ) {
          const gates: LogEntry[] = [];
          let k = j + 1;
          while (k < grouped.length) {
            const next = grouped[k];
            if (
              next.type === "gate_started" ||
              next.type === "gate_output" ||
              next.type === "gate_completed"
            ) {
              gates.push(next as LogEntry);
              k++;
            } else {
              break;
            }
          }
          if (gates.length > 0) {
            supersededGateEntries = gates;
            j = k - 1; // loop will increment to k, skipping collected entries
          }
        }

        items.push({
          kind: "agent-entry",
          entry,
          projectRoot: opts.projectRoot,
          artifactContext: opts.artifactContext,
          latestArtifactId: opts.latestArtifactId,
          taskResources: opts.taskResources,
          isBlockEnd: j === grouped.length - 1,
          gateEntries: supersededGateEntries,
        });
      }
      lastAgentBlockEndIndex = items.length - 1;
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

  // Mermaid/wireframe blocks need React lifecycle — fall back to ReactMarkdown.
  if (hasRichBlocks(cleaned)) {
    return (
      <div className={`text-forge-body py-3 ${PROSE_CLASSES}`}>
        <ReactMarkdown remarkPlugins={richContentPlugins} components={richContentComponents}>
          {cleaned}
        </ReactMarkdown>
      </div>
    );
  }

  // Plain markdown — cached HTML, instant on Virtua remount.
  return (
    <div
      className={`text-forge-body py-3 ${PROSE_CLASSES}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify
      dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(cleaned) }}
    />
  );
});

export const AgentEntry = memo(function AgentEntry({
  entry,
  projectRoot,
  artifactContext,
  latestArtifactId,
  taskResources,
  gateEntries,
}: {
  entry: GroupedLogEntry;
  projectRoot?: string;
  artifactContext?: ArtifactContext;
  latestArtifactId?: string;
  taskResources?: Record<string, WorkflowResource>;
  gateEntries?: LogEntry[];
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

    case "tool_group": {
      const summaries = entry.inputs.map((input) => toolSummary(input, projectRoot));
      // Bash: stacked lines, label visible only on first (invisible placeholder keeps alignment)
      if (entry.inputs[0]?.tool === "bash") {
        return (
          <div className="py-1">
            {summaries.map((s, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered list
              <div key={i} className="flex items-baseline gap-2">
                <span
                  className={`font-mono text-forge-mono-sm font-medium shrink-0 text-text-tertiary ${i > 0 ? "invisible" : ""}`}
                >
                  {entry.tool}
                </span>
                <span className="font-mono text-forge-mono-sm text-text-quaternary truncate min-w-0">
                  {s}
                </span>
              </div>
            ))}
          </div>
        );
      }
      // Other tools: compact single line with common-prefix compression
      return (
        <ToolLine label={entry.tool} summary={compactGroupSummary(summaries)} variant="tool" />
      );
    }

    case "error":
      return <ErrorLine message={entry.message} />;

    case "artifact_produced": {
      const artifact = entry.artifact;
      if (!artifact) return null;
      const isLatest = latestArtifactId !== undefined && entry.artifact_id === latestArtifactId;
      const stageResources = taskResources
        ? Object.values(taskResources)
            .filter((r) => r.stage === artifact.stage)
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
        : [];
      const resourcesElement =
        stageResources.length > 0 ? (
          <div className="border-t border-border p-4 flex flex-col gap-3">
            {stageResources.map((r) => (
              <ResourceItem key={r.name} resource={r} />
            ))}
          </div>
        ) : null;
      if (isLatest && artifactContext?.questionsElement) {
        return <>{artifactContext.questionsElement}</>;
      }
      if (isLatest && artifactContext) {
        const { actions } = artifactContext;
        return (
          <>
            <ArtifactLogCard
              artifact={artifact}
              needsReview={actions?.needsReview}
              verdict={actions?.verdict}
              rejectionTarget={actions?.rejectionTarget}
              onApprove={actions?.onApprove}
              loading={actions?.loading}
            />
            {resourcesElement}
          </>
        );
      }
      return (
        <>
          <ArtifactLogCard
            artifact={artifact}
            superseded={latestArtifactId !== undefined}
            gateEntries={gateEntries}
          />
          {resourcesElement}
        </>
      );
    }

    case "gate_started":
      return (
        <div className="flex items-center gap-2 py-2">
          <div className="h-px flex-1 bg-border" />
          <span className="font-mono text-forge-mono-sm text-text-tertiary shrink-0">
            Gate: {entry.command}
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
      );

    case "gate_output":
      return (
        <pre className="font-mono text-forge-mono-sm whitespace-pre-wrap text-text-secondary py-0.5">
          <AnsiText text={entry.content} />
        </pre>
      );

    case "gate_completed":
      return (
        <div
          className={`font-mono text-forge-mono-sm py-1 ${
            entry.passed ? "text-status-success" : "text-status-error"
          }`}
        >
          {entry.passed ? "Gate passed" : `Gate failed (exit ${entry.exit_code})`}
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
});

// ============================================================================
// VirtualItemRenderer
// ============================================================================

const VirtualItemRenderer = memo(function VirtualItemRenderer({
  item,
  contentFilter,
  initialLabel,
  onArtifactHeaderClick,
  artifactBodyCollapsed,
  onToggleArtifactBody,
  gateView,
  onToggleGateView,
}: {
  item: VirtualItem;
  contentFilter?: (content: string) => string;
  initialLabel?: string;
  onArtifactHeaderClick?: () => void;
  artifactBodyCollapsed?: boolean;
  onToggleArtifactBody?: () => void;
  gateView?: boolean;
  onToggleGateView?: () => void;
}) {
  const isMobile = useIsMobile();
  switch (item.kind) {
    case "user-block": {
      const content = contentFilter ? contentFilter(item.msg.content) : item.msg.content;
      if (item.isHuman) {
        return (
          <div className={`flex justify-end ${isMobile ? "px-2" : "px-6"} py-1`}>
            <div className="max-w-[90%] bg-surface-3 rounded-xl rounded-tr-none px-4 py-2.5">
              <div className={`text-forge-body text-text-primary ${PROSE_CLASSES}`}>
                <ReactMarkdown
                  remarkPlugins={richContentPlugins}
                  components={richContentComponents}
                >
                  {content}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        );
      }
      return (
        <div className={`flex justify-end ${isMobile ? "px-2" : "px-6"} py-2`}>
          <div className="max-w-[90%] bg-accent-soft rounded-xl rounded-tr-none px-5 py-4">
            <div className="font-mono text-forge-mono-sm text-text-secondary">
              {item.msg.resumeType === "initial" ? (initialLabel ?? "Starting…") : content}
            </div>
            {(item.msg.sections ?? []).length > 0 && (
              <div className="mt-3 flex flex-col gap-3">
                {(item.msg.sections ?? []).map((section, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered list
                  <div key={i} className="border-l-2 border-l-border pl-3">
                    <div className="font-mono text-forge-mono-sm font-medium text-text-tertiary mb-1">
                      {section.label}
                    </div>
                    <div className={`text-forge-body text-text-secondary ${PROSE_CLASSES}`}>
                      <ReactMarkdown
                        remarkPlugins={richContentPlugins}
                        components={richContentComponents}
                      >
                        {section.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }
    case "agent-entry":
      return (
        <div
          className={`bg-canvas ${isMobile ? "px-2" : "px-6"} text-text-secondary ${item.isBlockEnd ? "pb-2" : ""}`}
        >
          <AgentEntry
            entry={item.entry}
            projectRoot={item.projectRoot}
            artifactContext={item.artifactContext}
            latestArtifactId={item.latestArtifactId}
            taskResources={item.taskResources}
            gateEntries={item.gateEntries}
          />
        </div>
      );
    case "artifact-header": {
      const { actions } = item.artifactContext;
      return (
        // Sticky positioning is applied by Virtua's item wrapper (see stickyItemComponent below).
        <div className={`bg-canvas ${isMobile ? "px-2" : "px-6"}`}>
          {/* Opaque cap — masks content scrolling through the gap above the sticky header. */}
          <div className="h-6 bg-canvas" aria-hidden="true" />
          {/* biome-ignore lint/a11y/useSemanticElements: contains inner <Button> */}
          <div
            role="button"
            tabIndex={0}
            className="flex items-center justify-between px-3 py-2 bg-surface border border-border rounded-t-lg cursor-pointer hover:bg-surface-2 has-[button:hover]:bg-surface"
            onClick={onArtifactHeaderClick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onArtifactHeaderClick?.();
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <ArtifactBadge
                artifactName={item.artifact.name}
                verdict={actions?.verdict}
                rejectionTarget={actions?.rejectionTarget}
              />
              <span className="text-forge-mono-label text-text-tertiary truncate">
                Iteration {item.artifact.iteration} · {formatTimestamp(item.artifact.created_at)}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-2">
              {actions?.needsReview && (
                <Button
                  variant="violet"
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.onApprove?.();
                  }}
                  disabled={actions.loading}
                >
                  Approve
                </Button>
              )}
              {item.artifactContext.gateEntries && item.artifactContext.gateEntries.length > 0 && (
                <button
                  type="button"
                  className={`p-1 rounded hover:bg-surface-2 ${
                    gateView
                      ? "text-text-secondary"
                      : "text-text-tertiary hover:text-text-secondary"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleGateView?.();
                  }}
                  title={gateView ? "Show artifact" : "Show gate output"}
                >
                  {item.artifactContext.gatePassed ? (
                    <ShieldCheck className="w-4 h-4 text-status-success" />
                  ) : item.artifactContext.gateEntries.some(
                      (e) => e.type === "gate_completed" && !e.passed,
                    ) ? (
                    <ShieldX className="w-4 h-4 text-status-error" />
                  ) : (
                    <Shield
                      className={`w-4 h-4 ${item.artifactContext.isGateRunning ? "text-accent animate-spin-bounce" : ""}`}
                    />
                  )}
                </button>
              )}
              <button
                type="button"
                className="p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleArtifactBody?.();
                }}
              >
                {artifactBodyCollapsed ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronUp className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      );
    }
    case "artifact-body": {
      const stageResources = item.taskResources
        ? Object.values(item.taskResources)
            .filter((r) => r.stage === item.artifact.stage)
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
        : [];
      const showGate = gateView && item.gateEntries && item.gateEntries.length > 0;
      return (
        <div className={`${isMobile ? "px-2" : "px-6"} ${item.isBlockEnd ? "pb-2" : ""}`}>
          {showGate ? (
            <div className="border-l border-r border-b border-border rounded-b-lg bg-surface px-3 pt-2 pb-3">
              {item.gateEntries?.map((ge, idx) => {
                if (ge.type === "gate_started") {
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered list
                    <div key={idx} className="font-mono text-forge-mono-sm text-text-tertiary py-1">
                      Running: {ge.command}
                    </div>
                  );
                }
                if (ge.type === "gate_output") {
                  const outputCls =
                    "font-mono text-forge-mono-sm whitespace-pre-wrap text-text-secondary py-0.5";
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered list
                    <pre key={idx} className={outputCls}>
                      <AnsiText text={ge.content} />
                    </pre>
                  );
                }
                if (ge.type === "gate_completed") {
                  const completedCls = `font-mono text-forge-mono-sm py-1 ${ge.passed ? "text-status-success" : "text-status-error"}`;
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable ordered list
                    <div key={idx} className={completedCls}>
                      {ge.passed ? "Gate passed" : `Gate failed (exit ${ge.exit_code})`}
                    </div>
                  );
                }
                return null;
              })}
            </div>
          ) : (
            <ArtifactLogCard artifact={item.artifact} bodyOnly />
          )}
          {stageResources.length > 0 && (
            <div className="border-t border-border p-4 flex flex-col gap-3">
              {stageResources.map((r) => (
                <ResourceItem key={r.name} resource={r} />
              ))}
            </div>
          )}
        </div>
      );
    }
    case "extra":
      return <div className={`bg-canvas ${isMobile ? "px-2" : "px-6"} pb-3.5`}>{item.content}</div>;
    case "spinner":
      return (
        <div
          className={`flex items-center gap-2 ${isMobile ? "px-2" : "px-6"} py-3.5 text-text-quaternary`}
        >
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
  /** Label shown on agent message blocks. Defaults to "Agent". */
  agentLabel?: string;
  /** Label shown on user message blocks when classifyUser is not provided. Defaults to "You". */
  userLabel?: string;
  /** Per-message classification for user messages — provides label and accent style. */
  classifyUser?: (msg: UserMessage) => UserClassification;
  /** Transforms user message content before rendering. Defaults to identity. */
  contentFilter?: (content: string) => string;
  /** Context for rendering the latest artifact with actions or questions. */
  artifactContext?: ArtifactContext;
  /** The artifact_id of the latest artifact_produced log entry — only this entry gets actions. */
  latestArtifactId?: string;
  /** All task resources, keyed by name — filtered by stage and shown below each artifact card. */
  taskResources?: Record<string, WorkflowResource>;
  /** Content rendered below the last agent message block (e.g. approve bar fallback). */
  lastAgentExtra?: React.ReactNode;
  /** Text shown when there are no messages and the agent is not running. */
  emptyText?: string;
  /** Text shown in the condensed bubble for the initial (resumeType="initial") message. Defaults to "Starting…". */
  initialLabel?: string;
  /**
   * When provided, MessageList becomes the scroll container (flex-1 overflow-y-auto) and
   * enables auto-scroll-to-bottom on new items. Pass a ref to allow external code (hotkeys)
   * to scroll the container. HistoricalRunView omits this to opt out of auto-scroll.
   */
  containerRef?: React.Ref<HTMLDivElement>;
  /**
   * Increment to force an immediate scroll-to-bottom and re-enable auto-scroll.
   * Use when the user submits a message so the feed jumps to the latest activity.
   */
  scrollToBottomTrigger?: number;
}

export function MessageList({
  messages,
  isAgentRunning,
  projectRoot,
  agentLabel = "Agent",
  userLabel = "You",
  classifyUser,
  contentFilter,
  artifactContext,
  latestArtifactId,
  taskResources,
  lastAgentExtra,
  emptyText = "No messages yet.",
  initialLabel,
  containerRef,
  scrollToBottomTrigger,
}: MessageListProps) {
  const isScrollContainer = containerRef != null;

  const [artifactBodyCollapsed, setArtifactBodyCollapsed] = useState(false);
  const handleToggleArtifactBody = useCallback(() => setArtifactBodyCollapsed((v) => !v), []);

  // Gate view: when true, artifact-body shows gate output instead of artifact content.
  const [gateView, setGateView] = useState(false);
  const handleToggleGateView = useCallback(() => setGateView((v) => !v), []);

  // Custom Virtua item wrapper that makes the artifact-header item sticky once the user has
  // scrolled past it. Both refs are written during render so the stable component always
  // reads current values without needing to be recreated.
  const artifactHeaderIndexRef = useRef(-1);
  const stickyActiveRef = useRef(false);
  const stickyItemComponent = useMemo(
    () =>
      forwardRef<HTMLDivElement, CustomItemComponentProps>(function StickyAwareItem(
        { style, index, children },
        ref,
      ) {
        const isSticky = stickyActiveRef.current && index === artifactHeaderIndexRef.current;
        // top: -24 hides the 24px (h-6) canvas cap above the fold so the header card lands flush at y=0.
        return (
          <div
            ref={ref}
            style={isSticky ? { ...style, position: "sticky", top: -24, zIndex: 10 } : style}
          >
            {children}
          </div>
        );
      }),
    [],
  );
  // Track whether the user has scrolled past the artifact header's natural position.
  const virtualizerRef = useRef<VirtualizerHandle>(null);
  const [stickyActive, setStickyActive] = useState(false);
  stickyActiveRef.current = stickyActive;

  // Index of the artifact-body item — set during render so the click handler always reads current.
  const artifactBodyIndexRef = useRef(-1);

  // Scroll to the artifact body when the sticky header is clicked.
  const handleArtifactHeaderClick = useCallback(() => {
    const idx = artifactBodyIndexRef.current;
    if (idx !== -1 && virtualizerRef.current) {
      virtualizerRef.current.scrollToIndex(idx, { align: "start" });
    }
  }, []);

  // Flatten messages into virtual items (memoized)
  const virtualItems = useMemo(
    () =>
      buildVirtualItems(messages, {
        agentLabel,
        userLabel,
        classifyUser,
        projectRoot,
        artifactContext,
        latestArtifactId,
        taskResources,
        isAgentRunning,
        lastAgentExtra,
      }),
    [
      messages,
      agentLabel,
      userLabel,
      classifyUser,
      projectRoot,
      artifactContext,
      latestArtifactId,
      taskResources,
      isAgentRunning,
      lastAgentExtra,
    ],
  );

  // Filter out artifact-body when collapsed.
  const displayVirtualItems = useMemo(
    () =>
      artifactBodyCollapsed ? virtualItems.filter((v) => v.kind !== "artifact-body") : virtualItems,
    [virtualItems, artifactBodyCollapsed],
  );

  // Auto-switch gate view based on gate state transitions.
  // Extract primitives so the effect only fires when values actually change, not on every
  // render that produces a new gateState object reference (which would reset manual toggles).
  const gateBodyItem = useMemo(
    () =>
      virtualItems.find(
        (v): v is Extract<VirtualItem, { kind: "artifact-body" }> => v.kind === "artifact-body",
      ),
    [virtualItems],
  );
  const gateExists = (gateBodyItem?.gateEntries?.length ?? 0) > 0;
  const isGateRunning = gateExists && (gateBodyItem?.isGateRunning ?? false);
  const gatePassed = gateExists && (gateBodyItem?.gatePassed ?? false);

  useEffect(() => {
    if (!gateExists) return;
    if (isGateRunning)
      setGateView(true); // Gate started → show output
    else if (gatePassed)
      setGateView(false); // Gate passed → show artifact
    else setGateView(true); // Gate failed → show gate logs
  }, [gateExists, isGateRunning, gatePassed]);

  // -- Auto-scroll state (only relevant when isScrollContainer) --
  const internalContainerRef = useRef<HTMLDivElement | null>(null);
  // True when the user has scrolled up away from the bottom — disables auto-scroll.
  const isUserScrolledUpRef = useRef(false);
  // Tracks last scrollTop to detect direction (decrease = user scrolled up).
  const lastScrollTopRef = useRef(0);

  // Merge our internal ref with the external containerRef (for hotkey scroll control).
  const mergedContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      internalContainerRef.current = node;
      // Re-enable auto-scroll whenever a new container mounts (tab switch, drawer open).
      if (node) {
        isUserScrolledUpRef.current = false;
        lastScrollTopRef.current = 0;
      }
      if (typeof containerRef === "function") {
        containerRef(node);
      } else if (containerRef && typeof containerRef === "object") {
        (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [containerRef],
  );

  // Direction-based scroll detection:
  // - scrollTop decreased → user scrolled up → disable auto-scroll
  // - within 5px of bottom → re-enable auto-scroll
  const handleScrollInternal = useCallback(() => {
    const el = internalContainerRef.current;
    if (!el) return;
    const currentScrollTop = el.scrollTop;
    const distFromBottom = el.scrollHeight - currentScrollTop - el.clientHeight;
    if (distFromBottom <= 5) {
      isUserScrolledUpRef.current = false;
    } else if (currentScrollTop < lastScrollTopRef.current) {
      isUserScrolledUpRef.current = true;
    }
    lastScrollTopRef.current = currentScrollTop;
  }, []);

  // Activate sticky once the user has scrolled past the artifact header's natural position.
  const handleVirtuaScroll = useCallback(
    (offset: number) => {
      handleScrollInternal();
      const idx = artifactHeaderIndexRef.current;
      if (idx === -1 || !virtualizerRef.current) return;
      const headerOffset = virtualizerRef.current.getItemOffset(idx);
      // Activate sticky when the header card (24px below item top due to cap) reaches y=0,
      // so the transition is seamless with no positional jump.
      setStickyActive(offset >= headerOffset + 24);
    },
    [handleScrollInternal],
  );

  // When the user submits a message, jump to the bottom and re-enable auto-scroll.
  useEffect(() => {
    if (!scrollToBottomTrigger) return;
    isUserScrolledUpRef.current = false;
    const el = internalContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [scrollToBottomTrigger]);

  // RAF retry loop: set scrollTop = scrollHeight on each frame until scrollHeight stabilizes.
  //
  // Why retries are needed: Virtua measures item heights asynchronously via ResizeObserver.
  // On first render, all item heights are estimated (often 0). scrollHeight starts small, so
  // a single scroll lands at the wrong offset. As ResizeObserver fires between frames,
  // scrollHeight grows. We keep scrolling to the new bottom on each frame until scrollHeight
  // stops growing — that's when Virtua has finished measuring and we're truly at the bottom.
  //
  // Note: `el.scrollTop = el.scrollHeight` is always clamped to `scrollHeight - clientHeight`
  // by the browser, so distFromBottom is always 0 after the assignment. We cannot use
  // distFromBottom as the retry condition — we use scrollHeight growth instead.
  useEffect(() => {
    if (!isScrollContainer || virtualItems.length === 0 || isUserScrolledUpRef.current) return;
    let rafId: number;

    const artifactHeaderIdx = artifactHeaderIndexRef.current;
    // Only scroll to the artifact header when it's the last meaningful content — if there
    // are agent entries or user messages after it, scroll to the bottom instead.
    const artifactIsTerminal =
      artifactHeaderIdx !== -1 &&
      displayVirtualItems
        .slice(artifactHeaderIdx + 1)
        .every((v) => v.kind === "artifact-body" || v.kind === "spinner" || v.kind === "extra");
    if (artifactIsTerminal) {
      // Latest item is an artifact — scroll to its header so the user sees the top,
      // not the bottom of a potentially long artifact body.
      //
      // scrollToIndex handles unmeasured items natively: it runs an internal async
      // retry loop, re-scrolling each time ResizeObserver fires with new measurements,
      // until the offset stabilizes (no update within 150ms).
      virtualizerRef.current?.scrollToIndex(artifactHeaderIdx, { align: "start" });
      return;
    }

    // No artifact — scroll to bottom and chase Virtua's async measurements.
    let retries = 0;
    let prevScrollHeight = 0;
    // Frames to keep retrying after scrollHeight appears stable. Virtua measures item
    // heights in batches via ResizeObserver — there can be multiple frames between batches
    // (e.g. the superseded artifact card is measured, then items below it a few frames
    // later). Without this grace period the loop exits between batches and the final
    // scroll lands partway through the list instead of at the true bottom.
    let gracesRemaining = 8;
    const step = () => {
      const el = internalContainerRef.current;
      if (!el || retries >= 60 || isUserScrolledUpRef.current) return;
      retries++;
      el.scrollTop = el.scrollHeight;
      if (el.scrollHeight > prevScrollHeight) {
        prevScrollHeight = el.scrollHeight;
        gracesRemaining = 8;
        rafId = requestAnimationFrame(step);
      } else if (gracesRemaining > 0) {
        gracesRemaining--;
        rafId = requestAnimationFrame(step);
      }
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [virtualItems.length, isScrollContainer, displayVirtualItems]);

  const emptyState = (
    <div className="flex items-center justify-center h-full">
      <p className="font-mono text-forge-mono-sm text-text-quaternary">{emptyText}</p>
    </div>
  );

  if (isScrollContainer) {
    return (
      <div
        ref={mergedContainerRef}
        onScroll={handleScrollInternal}
        className="flex-1 overflow-y-auto bg-canvas pt-4 pb-4"
      >
        {virtualItems.length === 0 && !isAgentRunning
          ? emptyState
          : (() => {
              const artifactHeaderIndex = displayVirtualItems.findIndex(
                (v) => v.kind === "artifact-header",
              );
              artifactHeaderIndexRef.current = artifactHeaderIndex;
              artifactBodyIndexRef.current =
                artifactHeaderIndex !== -1 ? artifactHeaderIndex + 1 : -1;
              return (
                <Virtualizer
                  ref={virtualizerRef}
                  scrollRef={internalContainerRef}
                  bufferSize={800}
                  item={artifactHeaderIndex !== -1 ? stickyItemComponent : undefined}
                  keepMounted={
                    stickyActive && artifactHeaderIndex !== -1 ? [artifactHeaderIndex] : undefined
                  }
                  onScroll={artifactHeaderIndex !== -1 ? handleVirtuaScroll : undefined}
                >
                  {displayVirtualItems.map((item, i) => {
                    const p = {
                      item,
                      contentFilter,
                      initialLabel,
                      onArtifactHeaderClick: handleArtifactHeaderClick,
                      artifactBodyCollapsed,
                      onToggleArtifactBody: handleToggleArtifactBody,
                      gateView,
                      onToggleGateView: handleToggleGateView,
                    };
                    // biome-ignore lint/suspicious/noArrayIndexKey: append-only list, no reordering
                    return <VirtualItemRenderer key={i} {...p} />;
                  })}
                </Virtualizer>
              );
            })()}
      </div>
    );
  }

  // Non-scroll-container path (HistoricalRunView) — no auto-scroll, no Virtua.
  return (
    <div className="bg-canvas">
      {virtualItems.length === 0 && !isAgentRunning
        ? emptyState
        : virtualItems.map((item, i) => {
            const p = {
              item,
              contentFilter,
              initialLabel,
              gateView,
              onToggleGateView: handleToggleGateView,
            };
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
            return <VirtualItemRenderer key={i} {...p} />;
          })}
    </div>
  );
}
