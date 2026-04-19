// Feed log list — conversation-style activity log for FocusDrawer and ReviewDrawer.

import { useMemo } from "react";
import { useProjectInfo } from "../../hooks/useProjectInfo";
import type { LogEntry, WorkflowResource } from "../../types/workflow";
import { ErrorState } from "../ui";
import type { ArtifactContext, UserClassification, UserMessage } from "./MessageList";
import { buildDisplayMessages, MessageList } from "./MessageList";

// ============================================================================
// Helpers
// ============================================================================

export function classifyUser(msg: UserMessage): UserClassification {
  const resumeType = msg.resumeType;
  if (!resumeType) return { label: "System", isHuman: false };

  switch (resumeType) {
    case "feedback":
    case "answers":
    case "manual_resume":
    case "chat":
    case "return_to_work":
      return { label: "You", isHuman: true };
    case "initial":
    case "continue":
    case "recheck":
    case "retry_failed":
    case "retry_blocked":
    case "integration":
      return { label: "System", isHuman: false };
    default:
      return { label: "System", isHuman: false };
  }
}

// ============================================================================
// Public component
// ============================================================================

interface FeedLogListProps {
  logs: LogEntry[];
  error?: unknown;
  isAgentRunning?: boolean;
  artifactContext?: ArtifactContext;
  latestArtifactId?: string;
  taskResources?: Record<string, WorkflowResource>;
  lastAgentExtra?: React.ReactNode;
  containerRef?: React.Ref<HTMLDivElement>;
  /** Text shown in the condensed starting bubble. Defaults to "Starting…". */
  initialLabel?: string;
  /** Increment to force scroll-to-bottom and re-enable auto-scroll (e.g. on message send). */
  scrollToBottomTrigger?: number;
  /** Optimistic user message shown immediately on send, before real logs arrive. */
  pendingMessage?: string;
}

export function FeedLogList({
  logs,
  error,
  isAgentRunning = false,
  artifactContext,
  latestArtifactId,
  taskResources,
  lastAgentExtra,
  containerRef,
  initialLabel,
  scrollToBottomTrigger,
  pendingMessage,
}: FeedLogListProps) {
  const messages = useMemo(() => {
    const msgs = buildDisplayMessages(logs);
    if (pendingMessage) {
      msgs.push({ kind: "user", content: pendingMessage });
    }
    return msgs;
  }, [logs, pendingMessage]);
  const projectInfo = useProjectInfo();

  if (error != null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <ErrorState message="Failed to load logs" error={error} />
      </div>
    );
  }

  return (
    <MessageList
      messages={messages}
      isAgentRunning={isAgentRunning || !!pendingMessage}
      projectRoot={projectInfo?.project_root}
      emptyText="No activity yet."
      agentLabel="Agent"
      classifyUser={classifyUser}
      artifactContext={artifactContext}
      latestArtifactId={latestArtifactId}
      taskResources={taskResources}
      lastAgentExtra={lastAgentExtra}
      containerRef={containerRef}
      initialLabel={initialLabel}
      scrollToBottomTrigger={scrollToBottomTrigger}
    />
  );
}
