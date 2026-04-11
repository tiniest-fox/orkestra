// Tab body content switcher — renders the correct panel based on the active tab.

import { FileText } from "lucide-react";
import type { RefCallback } from "react";
import type { UseRunScriptResult } from "../../../hooks/useRunScript";
import type {
  LogEntry,
  WorkflowArtifact,
  WorkflowConfig,
  WorkflowResource,
  WorkflowTaskView,
} from "../../../types/workflow";
import { formatTimestamp } from "../../../utils";
import { EmptyState } from "../../ui/EmptyState";
import { ActivityLog } from "../ActivityLog";
import { ArtifactView } from "../ArtifactView";
import { DrawerDiffTab } from "../DrawerDiffTab";
import { DrawerGateTab } from "../DrawerGateTab";
import { DrawerPrTab } from "../DrawerPrTab";
import { FeedLogList } from "../FeedLogList";
import type { DrawerTabId } from "./drawerTabs";
import { LogsChatInput } from "./Footer/LogsChatInput";
import { ErrorTab } from "./Sections/ErrorTab";
import { QuestionsSection } from "./Sections/QuestionsSection";
import { ResourcesTab } from "./Sections/ResourcesTab";
import { RunTab } from "./Sections/RunTab";
import { SubtasksSection } from "./Sections/SubtasksSection";
import type { TaskDrawerState } from "./useTaskDrawerState";

// ============================================================================
// Types
// ============================================================================

interface DrawerTabContentProps {
  task: WorkflowTaskView;
  allTasks: WorkflowTaskView[];
  activeTab: DrawerTabId;
  artifact: WorkflowArtifact | null;
  config: WorkflowConfig;
  logs: LogEntry[];
  logsError: unknown;
  logContainerRef: RefCallback<HTMLDivElement>;
  handleLogScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  bodyRef: React.RefObject<HTMLDivElement>;
  state: TaskDrawerState;
  onOpenTask: (id: string) => void;
  runScript: UseRunScriptResult;
}

// ============================================================================
// Component
// ============================================================================

export function DrawerTabContent({
  task,
  allTasks,
  activeTab,
  artifact,
  config,
  logs,
  logsError,
  logContainerRef,
  handleLogScroll,
  bodyRef,
  state,
  onOpenTask,
  runScript,
}: DrawerTabContentProps) {
  const { submitRef } = state;

  if (activeTab === "diff") {
    return (
      <DrawerDiffTab
        active
        draftComments={state.draftComments}
        onAddDraftComment={
          task.derived.needs_review || task.derived.is_done ? state.addDraftComment : undefined
        }
        onRemoveDraftComment={state.removeDraftComment}
      />
    );
  }

  if (activeTab === "logs") {
    return (
      <>
        <FeedLogList
          logs={logs}
          error={logsError}
          isAgentRunning={task.derived.is_working || task.derived.chat_agent_active}
          containerRef={logContainerRef}
          onScroll={handleLogScroll}
        />
        {(task.derived.needs_review ||
          task.derived.has_questions ||
          task.derived.is_interrupted ||
          task.derived.is_chatting ||
          task.derived.is_working) && (
          <LogsChatInput
            chatMessage={state.chatMessage}
            onChatMessageChange={state.setChatMessage}
            chatTextareaRef={state.chatTextareaRef}
            chatSending={state.chatSending}
            chatAgentActive={task.derived.chat_agent_active || task.derived.is_working}
            onSendChat={state.handleSendChat}
            onInterrupt={
              task.derived.chat_agent_active ? state.handleChatStop : state.handleInterrupt
            }
            chatError={state.chatError}
          />
        )}
      </>
    );
  }

  if (activeTab === "artifact") {
    const verdict = task.derived.pending_rejection
      ? ("rejected" as const)
      : task.derived.pending_approval
        ? ("approved" as const)
        : undefined;
    const rejectionTarget = task.derived.pending_rejection?.target;

    const stageResources = artifact
      ? Object.values(task.resources)
          .filter((r) => r.stage === artifact.stage)
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
      : [];

    return (
      <div ref={bodyRef} className="flex-1 overflow-y-auto">
        {artifact ? (
          <>
            <ArtifactView artifact={artifact} verdict={verdict} rejectionTarget={rejectionTarget} />
            {stageResources.length > 0 && <StageResources resources={stageResources} />}
          </>
        ) : (
          <EmptyState icon={FileText} message="No artifact yet." />
        )}
      </div>
    );
  }

  if (activeTab === "history") {
    return (
      <div ref={bodyRef} className="flex-1 overflow-y-auto">
        <ActivityLog iterations={task.iterations} />
      </div>
    );
  }

  if (activeTab === "questions") {
    return (
      <QuestionsSection
        task={task}
        questions={task.derived.pending_questions}
        answers={state.answers}
        setAnswer={state.setAnswer}
        onFocusSubmit={() => submitRef.current?.focus()}
        loading={state.loading}
      />
    );
  }

  if (activeTab === "subtasks") {
    return <SubtasksSection task={task} allTasks={allTasks} active onOpenTask={onOpenTask} />;
  }

  if (activeTab === "error") {
    return <ErrorTab task={task} bodyRef={bodyRef} />;
  }

  if (activeTab === "pr" && task.pr_url) {
    return (
      <DrawerPrTab
        taskId={task.id}
        prUrl={task.pr_url}
        baseBranch={task.base_branch}
        branchName={task.branch_name ?? ""}
        onPrStateChange={state.setPrTabState}
      />
    );
  }

  if (activeTab === "gate") {
    return <DrawerGateTab task={task} config={config} />;
  }

  if (activeTab === "resources") {
    return <ResourcesTab task={task} bodyRef={bodyRef} />;
  }

  if (activeTab === "run") {
    return (
      <RunTab
        status={runScript.status}
        lines={runScript.lines}
        loading={runScript.loading}
        error={runScript.error}
        start={runScript.start}
        stop={runScript.stop}
      />
    );
  }

  return null;
}

// ============================================================================
// Helpers
// ============================================================================

function StageResources({ resources }: { resources: WorkflowResource[] }) {
  return (
    <div className="border-t border-border p-4 flex flex-col gap-3">
      {resources.map((r) => (
        <div key={r.name} className="flex flex-col gap-1">
          <span className="text-forge-mono-sm font-semibold text-text-primary">{r.name}</span>
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-forge-mono-sm text-accent truncate"
          >
            {r.url}
          </a>
          {r.description && (
            <span className="text-forge-mono-sm text-text-secondary">{r.description}</span>
          )}
          <span className="text-forge-mono-label text-text-tertiary">
            {r.stage} · {formatTimestamp(r.created_at)}
          </span>
        </div>
      ))}
    </div>
  );
}
