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
  FlexContainer,
  OverlayContainer,
  Panel,
  PanelLayout,
  Slot,
  TabbedPanel,
  TaskDetailTabs,
} from "../ui";
import { ArtifactsTab } from "./ArtifactsTab";
import { DeleteConfirmPanel } from "./DeleteConfirmPanel";
import { DetailsTab } from "./DetailsTab";
import { IntegrationPanel } from "./IntegrationPanel";
import { IterationsTab } from "./IterationsTab";
import { LogsTab } from "./LogsTab";
import { QuestionFormPanel } from "./QuestionFormPanel";
import { ResumePanel } from "./ResumePanel";
import { ReviewPanel } from "./ReviewPanel";
import { SubtasksTab } from "./SubtasksTab";
import { TaskDetailHeader } from "./TaskDetailHeader";
import { buildTabs, smartDefaultTab } from "./tabSelection";

/**
 * Prefix used by backend to indicate PR creation failures.
 * @see crates/orkestra-core/src/workflow/services/integration.rs (pr_creation_failed)
 */
const PR_CREATION_FAILURE_PREFIX = "PR creation failed:";

interface TaskDetailSidebarProps {
  task: WorkflowTaskView;
  onClose: () => void;
  onDelete?: () => void;
  /** Subtasks for this task (from shared TasksProvider). */
  subtasks?: WorkflowTaskView[];
  selectedSubtaskId?: string;
  onSelectSubtask?: (subtask: WorkflowTaskView) => void;
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
    interrupt,
    resume,
    mergeTask,
    openPr,
    retryPr,
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

  const handleRetry = async (instructions?: string) => {
    setIsRetrying(true);
    try {
      await retry(instructions);
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

  // Determine which footer panel to show
  const showDelete = confirmingDelete && !isSubtask;
  const showQuestions = !showDelete && task.derived.has_questions;
  const showResume = !showDelete && !showQuestions && task.derived.is_interrupted;
  const showReview =
    !showDelete &&
    !showQuestions &&
    !showResume &&
    task.derived.needs_review &&
    task.derived.current_stage;
  // Show integration panel for Done+Idle tasks (ready to merge or PR)
  // Also show for PR creation failures (error starts with PR_CREATION_FAILURE_PREFIX)
  const isPrCreationFailure =
    task.status.type === "failed" && task.status.error?.startsWith(PR_CREATION_FAILURE_PREFIX);
  const showIntegration =
    !showDelete &&
    !showQuestions &&
    !showResume &&
    !showReview &&
    ((task.derived.is_done && task.phase === "idle") || isPrCreationFailure);
  const showCompactFooter = !!(showDelete || showReview || showResume || showIntegration);

  return (
    <PanelLayout direction="vertical">
      {/* Main content panel */}
      <Slot id="details-main" type="grow" visible={true}>
        <Panel autoFill>
          <FlexContainer direction="vertical" padded={true}>
            <OverlayContainer className="flex flex-1 flex-col min-h-0">
              <FlexContainer direction="vertical">
                <TaskDetailHeader
                  task={task}
                  hasQuestions={task.derived.has_questions}
                  needsReview={task.derived.needs_review}
                  onClose={onClose}
                  onRequestDelete={() => setConfirmingDelete(true)}
                  onToggleAutoMode={handleToggleAutoMode}
                  onInterrupt={interrupt}
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
              </FlexContainer>
            </OverlayContainer>
          </FlexContainer>
        </Panel>
      </Slot>

      {/* Footer panel for questions - tall slot for complex UI */}
      <Slot id="details-footer-questions" type="fixed" size={480} visible={showQuestions} plain>
        <QuestionFormPanel
          questions={task.derived.pending_questions}
          onSubmit={answerQuestions}
          isSubmitting={isSubmitting}
        />
      </Slot>

      {/* Footer panel for compact actions - smaller slot for review/delete/resume */}
      <Slot id="details-footer-compact" type="fixed" size={200} visible={showCompactFooter} plain>
        {showDelete && (
          <DeleteConfirmPanel
            onConfirm={() => {
              setConfirmingDelete(false);
              onDelete?.();
            }}
            onCancel={() => setConfirmingDelete(false)}
          />
        )}

        {showResume && <ResumePanel onResume={resume} isSubmitting={isSubmitting} />}

        {showReview && (
          <ReviewPanel
            stageName={currentStageDisplayName}
            onApprove={approve}
            onReject={reject}
            isSubmitting={isSubmitting}
            pendingRejection={task.derived.pending_rejection}
          />
        )}

        {showIntegration && (
          <IntegrationPanel
            status={task.status}
            onMerge={mergeTask}
            onOpenPr={openPr}
            onRetryPr={retryPr}
            isSubmitting={isSubmitting}
          />
        )}
      </Slot>
    </PanelLayout>
  );
}
