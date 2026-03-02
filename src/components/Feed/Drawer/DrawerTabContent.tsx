//! Tab body content switcher — renders the correct panel based on the active tab.

import { FileText } from "lucide-react";
import type { RefCallback } from "react";
import type { UseRunScriptResult } from "../../../hooks/useRunScript";
import type {
  LogEntry,
  WorkflowArtifact,
  WorkflowConfig,
  WorkflowTaskView,
} from "../../../types/workflow";
import { EmptyState } from "../../ui/EmptyState";
import { ActivityLog } from "../ActivityLog";
import { ArtifactView } from "../ArtifactView";
import { DrawerDiffTab } from "../DrawerDiffTab";
import { DrawerGateTab } from "../DrawerGateTab";
import { DrawerPrTab } from "../DrawerPrTab";
import { FeedLogList } from "../FeedLogList";
import type { DrawerTabId } from "./drawerTabs";
import { ErrorTab } from "./Sections/ErrorTab";
import { QuestionsSection } from "./Sections/QuestionsSection";
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
      <div ref={logContainerRef} onScroll={handleLogScroll} className="flex-1 overflow-y-auto p-4">
        <FeedLogList logs={logs} error={logsError} />
      </div>
    );
  }

  if (activeTab === "artifact") {
    return (
      <div ref={bodyRef} className="flex-1 overflow-y-auto">
        {artifact ? (
          <ArtifactView artifact={artifact} />
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
        onPrStateChange={state.setPrTabState}
      />
    );
  }

  if (activeTab === "gate") {
    return <DrawerGateTab task={task} config={config} />;
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
