// Feed log list — conversation-style activity log for FocusDrawer and ReviewDrawer.

import { useMemo } from "react";
import { useProjectInfo } from "../../hooks/useProjectInfo";
import type { LogEntry, WorkflowArtifact, WorkflowResource } from "../../types/workflow";
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
    case "initial":
    case "feedback":
    case "answers":
    case "manual_resume":
    case "chat":
    case "return_to_work":
      return { label: "You", isHuman: true };
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
  artifacts?: Record<string, WorkflowArtifact>;
  artifactContext?: ArtifactContext;
  latestArtifactId?: string;
  taskResources?: Record<string, WorkflowResource>;
  lastAgentExtra?: React.ReactNode;
  containerRef?: React.Ref<HTMLDivElement>;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
}

export function FeedLogList({
  logs,
  error,
  isAgentRunning = false,
  artifacts,
  artifactContext,
  latestArtifactId,
  taskResources,
  lastAgentExtra,
  containerRef,
  onScroll,
}: FeedLogListProps) {
  const messages = useMemo(() => buildDisplayMessages(logs), [logs]);
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
      isAgentRunning={isAgentRunning}
      projectRoot={projectInfo?.project_root}
      emptyText="No activity yet."
      agentLabel="Agent"
      classifyUser={classifyUser}
      artifacts={artifacts}
      artifactContext={artifactContext}
      latestArtifactId={latestArtifactId}
      taskResources={taskResources}
      lastAgentExtra={lastAgentExtra}
      containerRef={containerRef}
      onScroll={onScroll}
    />
  );
}
