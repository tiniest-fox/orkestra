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
import { Panel, PanelContainer, PanelSlot, TabbedPanel } from "../ui";
import { ArtifactsTab } from "./ArtifactsTab";
import { DetailsTab } from "./DetailsTab";
import { IterationsTab } from "./IterationsTab";
import { LogsTab } from "./LogsTab";
import { QuestionFormPanel } from "./QuestionFormPanel";
import { ReviewPanel } from "./ReviewPanel";
import { TaskDetailHeader } from "./TaskDetailHeader";

interface Tab {
  id: string;
  label: string;
}

interface TaskDetailSidebarProps {
  task: WorkflowTaskView;
  onClose: () => void;
  onDelete: () => void;
}

function buildTabs(task: WorkflowTaskView): Tab[] {
  const tabs: Tab[] = [
    { id: "details", label: "Details" },
    { id: "iterations", label: "Activity" },
    { id: "logs", label: "Logs" },
  ];

  const hasArtifacts = Object.keys(task.artifacts).length > 0;
  if (hasArtifacts) {
    tabs.push({ id: "artifacts", label: "Artifacts" });
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
    preferred = "artifacts";
  } else if (derived.is_failed || derived.is_blocked) {
    preferred = "details";
  } else if (task.status.type === "waiting_on_children") {
    preferred = "details";
  } else if (derived.is_working || task.phase === "integrating") {
    preferred = "logs";
  } else if (derived.needs_review) {
    preferred = "artifacts";
  } else {
    preferred = "details";
  }

  return tabIds.has(preferred) ? preferred : "details";
}

export function TaskDetailSidebar({ task, onClose, onDelete }: TaskDetailSidebarProps) {
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

  const logsState = useLogs(task, activeTab === "logs");

  // Reset state when task changes — pick the most relevant tab for the new task
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset when task.id changes
  useEffect(() => {
    setActiveTab(smartDefaultTab(task, tabs));
    logsState.reset();
  }, [task.id]);

  // Validate active tab exists
  useEffect(() => {
    if (!tabs.find((t) => t.id === activeTab)) {
      setActiveTab("details");
    }
  }, [tabs, activeTab]);

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

  const footerPanelKey = task.derived.has_questions
    ? "questions"
    : task.derived.needs_review && task.derived.current_stage
      ? "review"
      : null;

  return (
    <Panel className="w-[480px]">
      <PanelContainer direction="vertical" padded={true}>
        <PanelContainer direction="vertical">
          <TaskDetailHeader
            task={task}
            hasQuestions={task.derived.has_questions}
            needsReview={task.derived.needs_review}
            onClose={onClose}
            onDelete={onDelete}
            onToggleAutoMode={handleToggleAutoMode}
          />

          <TabbedPanel
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={(tabId) => setActiveTab(tabId)}
          >
            {activeTab === "details" && (
              <DetailsTab task={task} onRetry={handleRetry} isRetrying={isRetrying} />
            )}

            {activeTab === "artifacts" && (
              <ArtifactsTab
                taskId={task.id}
                currentStage={task.derived.current_stage}
                artifacts={task.artifacts}
                config={config}
              />
            )}

            {activeTab === "iterations" && <IterationsTab iterations={task.iterations} />}

            {activeTab === "logs" && (
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

        <PanelSlot activeKey={footerPanelKey} direction="vertical">
          <PanelSlot.Panel panelKey="questions">
            <QuestionFormPanel
              questions={task.derived.pending_questions}
              onSubmit={answerQuestions}
              isSubmitting={isSubmitting}
            />
          </PanelSlot.Panel>

          <PanelSlot.Panel panelKey="review">
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
