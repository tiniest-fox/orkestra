/**
 * Archive task detail view - read-only version of TaskDetailSidebar.
 *
 * Shows full task details (all tabs) but removes all action buttons
 * and the footer (no delete, approve, reject, questions, or review panels).
 */

import { useEffect, useMemo, useState } from "react";
import { useLogs } from "../hooks/useLogs";
import { useWorkflowConfig } from "../providers";
import type { WorkflowTaskView } from "../types/workflow";
import { ArchiveTaskDetailHeader } from "./TaskDetail/ArchiveTaskDetailHeader";
import { ArtifactsTab } from "./TaskDetail/ArtifactsTab";
import { DetailsTab } from "./TaskDetail/DetailsTab";
import { IterationsTab } from "./TaskDetail/IterationsTab";
import { LogsTab } from "./TaskDetail/LogsTab";
import { SubtasksTab } from "./TaskDetail/SubtasksTab";
import { buildTabs, smartDefaultTab } from "./TaskDetail/tabSelection";
import {
  FlexContainer,
  OverlayContainer,
  Panel,
  PanelLayout,
  Slot,
  TabbedPanel,
  TaskDetailTabs,
} from "./ui";

interface ArchiveTaskDetailViewProps {
  task: WorkflowTaskView;
  onClose: () => void;
  /** Subtasks for this task (from shared TasksProvider). */
  subtasks?: WorkflowTaskView[];
  selectedSubtaskId?: string;
  onSelectSubtask?: (subtask: WorkflowTaskView) => void;
}

export function ArchiveTaskDetailView({
  task,
  onClose,
  subtasks,
  selectedSubtaskId,
  onSelectSubtask,
}: ArchiveTaskDetailViewProps) {
  const config = useWorkflowConfig();

  const tabs = useMemo(() => buildTabs(task), [task]);
  const [activeTab, setActiveTab] = useState(() => smartDefaultTab(task, buildTabs(task)));

  const logsState = useLogs(task, activeTab === TaskDetailTabs.logs(task.id));

  // Reset state when task changes — pick the most relevant tab for the new task
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset when task.id changes
  useEffect(() => {
    setActiveTab(smartDefaultTab(task, tabs));
    logsState.reset();
  }, [task.id]);

  // Validate active tab exists
  useEffect(() => {
    if (!tabs.find((t) => t.id === activeTab)) {
      setActiveTab(TaskDetailTabs.details(task.id));
    }
  }, [tabs, activeTab, task.id]);

  return (
    <PanelLayout direction="vertical">
      {/* Main content panel */}
      <Slot id="archive-details-main" type="grow" visible={true}>
        <Panel autoFill>
          <FlexContainer direction="vertical" padded={true}>
            <OverlayContainer className="flex flex-1 flex-col min-h-0">
              <FlexContainer direction="vertical">
                <ArchiveTaskDetailHeader task={task} onClose={onClose} />

                <TabbedPanel
                  tabs={tabs}
                  activeTab={activeTab}
                  onTabChange={(tabId) => setActiveTab(tabId)}
                >
                  {activeTab === TaskDetailTabs.details(task.id) && <DetailsTab task={task} />}

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
    </PanelLayout>
  );
}
