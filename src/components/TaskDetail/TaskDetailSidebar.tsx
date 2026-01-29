/**
 * Task detail sidebar - orchestrates task detail tabs and actions.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLogs } from "../../hooks/useLogs";
import { useWorkflowActions, useWorkflowQueries } from "../../hooks/useWorkflow";
import type {
  WorkflowConfig,
  WorkflowIteration,
  WorkflowQuestion,
  WorkflowQuestionAnswer,
  WorkflowTask,
} from "../../types/workflow";
import { capitalizeFirst, getTaskStage, needsReview } from "../../types/workflow";
import { Panel, PanelContainer, PanelSlot, TabbedPanel } from "../ui";
import { ArtifactView } from "./ArtifactView";
import { DetailsTab } from "./DetailsTab";
import { IterationsTab } from "./IterationsTab";
import { LogsTab } from "./LogsTab";
import { QuestionFormPanel } from "./QuestionFormPanel";
import { ReviewPanel } from "./ReviewPanel";
import { TaskDetailHeader } from "./TaskDetailHeader";

interface Tab {
  id: string;
  label: string;
  type: "details" | "artifact" | "iterations" | "logs";
  artifactName?: string;
}

interface TaskDetailSidebarProps {
  task: WorkflowTask;
  config: WorkflowConfig;
  onClose: () => void;
  onTaskUpdated: () => void;
}

function buildTabs(task: WorkflowTask, config: WorkflowConfig): Tab[] {
  const tabs: Tab[] = [
    { id: "details", label: "Details", type: "details" },
    { id: "iterations", label: "Activity", type: "iterations" },
    { id: "logs", label: "Logs", type: "logs" },
  ];

  for (const stage of config.stages) {
    const artifactName = stage.artifact;
    if (task.artifacts[artifactName]) {
      tabs.push({
        id: `artifact-${artifactName}`,
        label: capitalizeFirst(artifactName),
        type: "artifact",
        artifactName,
      });
    }
  }

  return tabs;
}

export function TaskDetailSidebar({ task, config, onClose, onTaskUpdated }: TaskDetailSidebarProps) {
  const [activeTab, setActiveTab] = useState("details");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [iterations, setIterations] = useState<WorkflowIteration[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState<WorkflowQuestion[]>([]);

  const { approve, reject, answerQuestions, retry } = useWorkflowActions();
  const { getIterations, getPendingQuestions } = useWorkflowQueries();

  const logsState = useLogs(task, activeTab === "logs");

  const tabs = useMemo(() => buildTabs(task, config), [task, config]);

  const currentTab = tabs.find((t) => t.id === activeTab);
  const currentArtifact =
    currentTab?.type === "artifact" && currentTab.artifactName ? task.artifacts[currentTab.artifactName] : null;

  // Fetch iterations
  const fetchIterations = useCallback(async () => {
    try {
      const result = await getIterations(task.id);
      setIterations(result);
    } catch (err) {
      console.error("Failed to fetch iterations:", err);
      setIterations([]);
    }
  }, [task.id, getIterations]);

  useEffect(() => {
    fetchIterations();
  }, [fetchIterations]);

  // Fetch pending questions
  useEffect(() => {
    if (task.phase === "awaiting_review" && task.status.type === "active") {
      getPendingQuestions(task.id)
        .then(setPendingQuestions)
        .catch((err) => {
          console.error("Failed to fetch pending questions:", err);
          setPendingQuestions([]);
        });
    } else {
      setPendingQuestions([]);
    }
  }, [task.id, task.phase, task.status.type, getPendingQuestions]);

  // Reset state when task changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset when task.id changes
  useEffect(() => {
    setActiveTab("details");
    logsState.reset();
  }, [task.id]);

  // Validate active tab exists
  useEffect(() => {
    if (!tabs.find((t) => t.id === activeTab)) {
      setActiveTab("details");
    }
  }, [tabs, activeTab]);

  const taskNeedsReview = needsReview(task);
  const taskHasQuestions = pendingQuestions.length > 0;
  const currentStage = getTaskStage(task.status);
  const currentStageConfig = currentStage ? config.stages.find((s) => s.name === currentStage) : null;

  const handleApprove = async () => {
    setIsSubmitting(true);
    try {
      await approve(task.id);
      onTaskUpdated();
    } catch (err) {
      console.error("Failed to approve:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async (feedback: string) => {
    setIsSubmitting(true);
    try {
      await reject(task.id, feedback);
      onTaskUpdated();
    } catch (err) {
      console.error("Failed to reject:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAnswerQuestions = async (answers: WorkflowQuestionAnswer[]) => {
    setIsSubmitting(true);
    try {
      await answerQuestions(task.id, answers);
      onTaskUpdated();
    } catch (err) {
      console.error("Failed to submit answers:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await retry(task.id);
      onTaskUpdated();
    } catch (err) {
      console.error("Failed to retry task:", err);
    } finally {
      setIsRetrying(false);
    }
  };

  const footerPanelKey = taskHasQuestions ? "questions" : taskNeedsReview && currentStage ? "review" : null;

  return (
    <Panel>
      <PanelContainer direction="vertical" padded={true}>
        <PanelContainer direction="vertical">
          <TaskDetailHeader
            task={task}
            hasQuestions={taskHasQuestions}
            needsReview={taskNeedsReview}
            onClose={onClose}
          />

          <TabbedPanel tabs={tabs} activeTab={activeTab} onTabChange={(tabId) => setActiveTab(tabId)}>
            {activeTab === "details" && <DetailsTab task={task} onRetry={handleRetry} isRetrying={isRetrying} />}

            {currentTab?.type === "artifact" && currentArtifact && <ArtifactView artifact={currentArtifact} />}

            {activeTab === "iterations" && <IterationsTab iterations={iterations} />}

            {activeTab === "logs" && (
              <LogsTab
                task={task}
                logs={logsState.logs}
                isLoading={logsState.isLoading}
                error={logsState.error}
                stagesWithLogs={logsState.stagesWithLogs}
                activeLogStage={logsState.activeLogStage}
                onStageChange={logsState.setActiveLogStage}
                onResetAutoScroll={logsState.reset}
              />
            )}
          </TabbedPanel>
        </PanelContainer>

        <PanelSlot activeKey={footerPanelKey} direction="vertical">
          <PanelSlot.Panel panelKey="questions">
            <QuestionFormPanel
              questions={pendingQuestions}
              onSubmit={handleAnswerQuestions}
              isSubmitting={isSubmitting}
            />
          </PanelSlot.Panel>

          <PanelSlot.Panel panelKey="review">
            <ReviewPanel
              stageName={currentStageConfig?.display_name || currentStage || ""}
              onApprove={handleApprove}
              onReject={handleReject}
              isSubmitting={isSubmitting}
            />
          </PanelSlot.Panel>
        </PanelSlot>
      </PanelContainer>
    </Panel>
  );
}
