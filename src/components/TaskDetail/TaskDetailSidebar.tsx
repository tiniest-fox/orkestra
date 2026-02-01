/**
 * Task detail sidebar - orchestrates task detail tabs and actions.
 *
 * Data comes from TasksProvider (task view with iterations, sessions, derived state).
 * Actions are managed by the useTaskDetail hook.
 */

import { useEffect, useMemo, useState } from "react";
import { useLogs } from "../../hooks/useLogs";
import { useTaskDetail } from "../../hooks/useTaskDetail";
import { useWorkflowConfig } from "../../providers";
import type { WorkflowTaskView } from "../../types/workflow";
import {
  OverlayContainer,
  Panel,
  PanelContainer,
  PanelSlot,
  TabbedPanel,
  TaskDetailFooterSlot,
  TaskDetailTabs,
} from "../ui";
import { ArtifactsTab } from "./ArtifactsTab";
import { DeleteConfirmPanel } from "./DeleteConfirmPanel";
import { DetailsTab } from "./DetailsTab";
import { IterationsTab } from "./IterationsTab";
import { LogsTab } from "./LogsTab";
import { QuestionFormPanel } from "./QuestionFormPanel";
import { ReviewPanel } from "./ReviewPanel";
import { SubtasksTab } from "./SubtasksTab";
import { TaskDetailHeader } from "./TaskDetailHeader";

interface Tab {
  id: string;
  label: string;
}

interface TaskDetailSidebarProps {
  task: WorkflowTaskView;
  onClose: () => void;
  onDelete?: () => void;
  /** Subtasks for this task (from shared TasksProvider). */
  subtasks?: WorkflowTaskView[];
  selectedSubtaskId?: string;
  onSelectSubtask?: (subtask: WorkflowTaskView) => void;
}

function buildTabs(task: WorkflowTaskView): Tab[] {
  const tabs: Tab[] = [{ id: TaskDetailTabs.details(task.id), label: "Details" }];

  if (task.derived.subtask_progress) {
    tabs.push({
      id: TaskDetailTabs.subtasks(task.id),
      label: "Subtasks",
    });
  }

  tabs.push(
    { id: TaskDetailTabs.iterations(task.id), label: "Activity" },
    { id: TaskDetailTabs.logs(task.id), label: "Logs" },
  );

  const hasArtifacts = Object.keys(task.artifacts).length > 0;
  if (hasArtifacts) {
    tabs.push({ id: TaskDetailTabs.artifacts(task.id), label: "Artifacts" });
  }

  return tabs;
}

/**
 * Select the most relevant tab based on current task state.
 * Falls back to "details" if the preferred tab isn't available.
 */
function smartDefaultTab(task: WorkflowTaskView, tabs: Tab[]): string {
  const tabIds = new Set(tabs.map((t) => t.id));
  const { derived } = task;

  let preferred: string;
  if (derived.is_done || task.status.type === "archived") {
    preferred = TaskDetailTabs.artifacts(task.id);
  } else if (derived.is_failed || derived.is_blocked) {
    preferred = TaskDetailTabs.details(task.id);
  } else if (task.status.type === "waiting_on_children") {
    preferred = TaskDetailTabs.subtasks(task.id);
  } else if (derived.is_working || task.phase === "integrating") {
    preferred = TaskDetailTabs.logs(task.id);
  } else if (derived.needs_review) {
    preferred = TaskDetailTabs.artifacts(task.id);
  } else {
    preferred = TaskDetailTabs.details(task.id);
  }

  return tabIds.has(preferred) ? preferred : TaskDetailTabs.details(task.id);
}

export function TaskDetailSidebar({
  task,
  onClose,
  onDelete,
  subtasks,
  selectedSubtaskId,
  onSelectSubtask,
}: TaskDetailSidebarProps) {
  const isSubtask = !!task.parent_id;
  const config = useWorkflowConfig();
  const {
    currentStageDisplayName,
    isSubmitting,
    approve,
    reject,
    answerQuestions,
    retry,
    setAutoMode,
  } = useTaskDetail(task);

  const tabs = useMemo(() => buildTabs(task), [task]);
  const [activeTab, setActiveTab] = useState(() => smartDefaultTab(task, buildTabs(task)));

  const [isRetrying, setIsRetrying] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const logsState = useLogs(task, activeTab === TaskDetailTabs.logs(task.id));

  // Reset state when task changes — pick the most relevant tab for the new task
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset when task.id changes
  useEffect(() => {
    setActiveTab(smartDefaultTab(task, tabs));
    setConfirmingDelete(false);
    logsState.reset();
  }, [task.id]);

  // Validate active tab exists
  useEffect(() => {
    if (!tabs.find((t) => t.id === activeTab)) {
      setActiveTab(TaskDetailTabs.details(task.id));
    }
  }, [tabs, activeTab, task.id]);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await retry();
    } finally {
      setIsRetrying(false);
    }
  };

  const handleToggleAutoMode = async (autoMode: boolean) => {
    try {
      await setAutoMode(task.id, autoMode);
    } catch (err) {
      console.error("Failed to toggle auto mode:", err);
    }
  };

  const footerPanelKey =
    confirmingDelete && !isSubtask
      ? TaskDetailFooterSlot.Delete
      : task.derived.has_questions
        ? TaskDetailFooterSlot.Questions
        : task.derived.needs_review && task.derived.current_stage
          ? TaskDetailFooterSlot.Review
          : null;

  return (
    <Panel className="w-[480px]">
      <PanelContainer direction="vertical" padded={true}>
        <OverlayContainer className="flex flex-1 flex-col min-h-0">
          <PanelContainer direction="vertical">
            <TaskDetailHeader
              task={task}
              hasQuestions={task.derived.has_questions}
              needsReview={task.derived.needs_review}
              onClose={onClose}
              onRequestDelete={() => setConfirmingDelete(true)}
              onToggleAutoMode={handleToggleAutoMode}
            />

            <TabbedPanel
              tabs={tabs}
              activeTab={activeTab}
              onTabChange={(tabId) => setActiveTab(tabId)}
            >
              {activeTab === TaskDetailTabs.details(task.id) && (
                <DetailsTab task={task} onRetry={handleRetry} isRetrying={isRetrying} />
              )}

              {activeTab === TaskDetailTabs.subtasks(task.id) &&
                task.derived.subtask_progress &&
                subtasks && (
                  <SubtasksTab
                    subtasks={subtasks}
                    progress={task.derived.subtask_progress}
                    selectedSubtaskId={selectedSubtaskId}
                    onSelectSubtask={onSelectSubtask}
                  />
                )}

              {activeTab === TaskDetailTabs.artifacts(task.id) && (
                <ArtifactsTab
                  taskId={task.id}
                  currentStage={task.derived.current_stage}
                  artifacts={task.artifacts}
                  config={config}
                />
              )}

              {activeTab === TaskDetailTabs.iterations(task.id) && (
                <IterationsTab iterations={task.iterations} />
              )}

              {activeTab === TaskDetailTabs.logs(task.id) && (
                <LogsTab
                  task={task}
                  logs={logsState.logs}
                  isLoading={logsState.isLoading}
                  error={logsState.error}
                  stagesWithLogs={logsState.stagesWithLogs}
                  activeLogStage={logsState.activeLogStage}
                  onStageChange={logsState.setActiveLogStage}
                />
              )}
            </TabbedPanel>
          </PanelContainer>
        </OverlayContainer>

        <PanelSlot activeKey={footerPanelKey} direction="vertical">
          <PanelSlot.Panel panelKey={TaskDetailFooterSlot.Delete}>
            <DeleteConfirmPanel
              onConfirm={() => {
                setConfirmingDelete(false);
                onDelete?.();
              }}
              onCancel={() => setConfirmingDelete(false)}
            />
          </PanelSlot.Panel>

          <PanelSlot.Panel panelKey={TaskDetailFooterSlot.Questions}>
            <QuestionFormPanel
              questions={task.derived.pending_questions}
              onSubmit={answerQuestions}
              isSubmitting={isSubmitting}
            />
          </PanelSlot.Panel>

          <PanelSlot.Panel panelKey={TaskDetailFooterSlot.Review}>
            <ReviewPanel
              stageName={currentStageDisplayName}
              onApprove={approve}
              onReject={reject}
              isSubmitting={isSubmitting}
            />
          </PanelSlot.Panel>
        </PanelSlot>
      </PanelContainer>
    </Panel>
  );
}
