/**
 * Task detail sidebar for the workflow system.
 * Shows task details with dynamic artifact tabs based on task.artifacts.
 * Uses Panel-based design system with nested PanelSlots for review/questions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useWorkflowActions, useWorkflowQueries } from "../hooks/useWorkflow";
import type {
  LogEntry,
  WorkflowConfig,
  WorkflowIteration,
  WorkflowQuestion,
  WorkflowQuestionAnswer,
  WorkflowTask,
} from "../types/workflow";
import { capitalizeFirst, getTaskStage, needsReview } from "../types/workflow";
import { LogList } from "./LogEntryView";
import { Badge, Button, Panel, PanelContainer, PanelSlot, TabbedPanel } from "./ui";

/**
 * Tab definition for the sidebar.
 */
interface Tab {
  id: string;
  label: string;
  type: "details" | "artifact" | "iterations" | "logs";
  artifactName?: string;
}

interface WorkflowTaskDetailSidebarProps {
  task: WorkflowTask;
  config: WorkflowConfig;
  onClose: () => void;
  onTaskUpdated: () => void;
}

/**
 * Format timestamp for display.
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format outcome for display.
 */
function formatOutcome(outcome: WorkflowIteration["outcome"]): {
  label: string;
  color: string;
} | null {
  if (!outcome) return null;

  switch (outcome.type) {
    case "approved":
      return { label: "Approved", color: "text-green-700 bg-green-50" };
    case "rejected":
      return { label: "Rejected", color: "text-amber-700 bg-amber-50" };
    case "awaiting_answers":
      return { label: "Awaiting Answers", color: "text-blue-700 bg-blue-50" };
    case "completed":
      return { label: "Completed", color: "text-green-700 bg-green-50" };
    case "integration_failed":
      return { label: "Integration Failed", color: "text-red-700 bg-red-50" };
    case "agent_error":
      return { label: "Agent Error", color: "text-red-700 bg-red-50" };
    case "blocked":
      return { label: "Blocked", color: "text-orange-700 bg-orange-50" };
    case "skipped":
      return { label: "Skipped", color: "text-gray-700 bg-gray-50" };
    case "restage":
      return { label: `Restage to ${outcome.target}`, color: "text-purple-700 bg-purple-50" };
  }
}

/**
 * Build tabs from task artifacts in consistent order.
 * Order: Details, Iterations, Logs, then artifacts in stage order.
 */
function buildTabs(task: WorkflowTask, config: WorkflowConfig): Tab[] {
  const tabs: Tab[] = [
    { id: "details", label: "Details", type: "details" },
    { id: "iterations", label: "Activity", type: "iterations" },
    { id: "logs", label: "Logs", type: "logs" },
  ];

  // Add artifact tabs in stage order (using config.stages order)
  // Label uses the artifact name (e.g., "Plan", "Breakdown", "Summary")
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

/**
 * Question form component for answering pending questions.
 * Shows one question at a time with navigation controls.
 */
function QuestionFormSection({
  questions,
  onSubmit,
  isSubmitting,
}: {
  questions: WorkflowQuestion[];
  onSubmit: (answers: WorkflowQuestionAnswer[]) => void;
  isSubmitting: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  // Track which questions have "Other" selected
  const [otherSelected, setOtherSelected] = useState<Record<string, boolean>>({});
  // Track custom text for "Other" responses
  const [otherText, setOtherText] = useState<Record<string, string>>({});

  // Reset current index when questions change
  // Track by length and first question ID to detect meaningful changes
  const questionsKey = `${questions.length}-${questions[0]?.id ?? "none"}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset when questionsKey changes
  useEffect(() => {
    setCurrentIndex(0);
  }, [questionsKey]);

  const handleSubmit = () => {
    const formattedAnswers: WorkflowQuestionAnswer[] = questions.map((q) => ({
      question_id: q.id,
      question: q.question,
      // Use otherText if "Other" was selected, otherwise use the selected option
      answer: otherSelected[q.id] ? otherText[q.id] || "" : answers[q.id] || "",
      answered_at: new Date().toISOString(),
    }));
    onSubmit(formattedAnswers);
  };

  // Check if all questions are answered (considering "Other" selections)
  const allAnswered = questions.every((q) => {
    if (otherSelected[q.id]) {
      return otherText[q.id]?.trim();
    }
    return answers[q.id]?.trim();
  });
  const currentQuestion = questions[currentIndex];
  const isFirstQuestion = currentIndex === 0;
  const isLastQuestion = currentIndex === questions.length - 1;
  // Check if current question is answered (considering "Other" selection)
  const currentAnswered =
    currentQuestion &&
    (otherSelected[currentQuestion.id]
      ? otherText[currentQuestion.id]?.trim()
      : answers[currentQuestion.id]?.trim());

  const handlePrevious = () => {
    if (!isFirstQuestion) {
      setCurrentIndex((prev) => prev - 1);
    }
  };

  const handleNext = () => {
    if (!isLastQuestion) {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  if (!currentQuestion) return null;

  return (
    <Panel accent="info" autoFill={false} className="m-2 mt-0">
      <div className="p-4 flex flex-col">
        {/* Header with progress indicator */}
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium text-info">Questions</div>
          <div className="text-xs text-info/70">
            Question {currentIndex + 1} of {questions.length}
          </div>
        </div>

        {/* Scrollable question content */}
        <div className="overflow-auto max-h-[300px] mb-4">
          <div className="text-sm font-medium text-stone-800 mb-1">{currentQuestion.question}</div>
          {currentQuestion.context && (
            <div className="text-xs text-stone-500 mb-2">{currentQuestion.context}</div>
          )}
          <div className="space-y-1">
            {/* Render predefined options */}
            {currentQuestion.options?.map((option) => (
              <label key={option.id} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={currentQuestion.id}
                  value={option.id}
                  checked={
                    answers[currentQuestion.id] === option.id && !otherSelected[currentQuestion.id]
                  }
                  onChange={() => {
                    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: option.id }));
                    setOtherSelected((prev) => ({ ...prev, [currentQuestion.id]: false }));
                  }}
                  className="text-info mt-0.5 accent-info"
                />
                <div>
                  <span className="text-sm text-stone-700">{option.label}</span>
                  {option.description && (
                    <span className="text-xs text-stone-500 ml-1">- {option.description}</span>
                  )}
                </div>
              </label>
            ))}
            {/* "Other" option - always present */}
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name={currentQuestion.id}
                value="__other__"
                checked={otherSelected[currentQuestion.id] === true}
                onChange={() => {
                  setOtherSelected((prev) => ({ ...prev, [currentQuestion.id]: true }));
                  setAnswers((prev) => ({ ...prev, [currentQuestion.id]: "" }));
                }}
                className="text-info mt-0.5 accent-info"
              />
              <div>
                <span className="text-sm text-stone-700">Other (custom response)</span>
              </div>
            </label>
            {/* Text input for "Other" - shown when "Other" is selected */}
            {otherSelected[currentQuestion.id] && (
              <textarea
                value={otherText[currentQuestion.id] || ""}
                onChange={(e) =>
                  setOtherText((prev) => ({ ...prev, [currentQuestion.id]: e.target.value }))
                }
                placeholder="Type your custom response..."
                className="w-full mt-2 px-3 py-2 text-sm border border-stone-300 rounded-panel-sm focus:outline-none focus:ring-2 focus:ring-info resize-none text-stone-800"
                rows={2}
              />
            )}
          </div>
        </div>

        {/* Navigation controls */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePrevious}
            disabled={isFirstQuestion || isSubmitting}
            className="text-info hover:bg-blue-100"
          >
            Previous
          </Button>

          {isLastQuestion ? (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={isSubmitting || !allAnswered}
              loading={isSubmitting}
              className="bg-info hover:bg-blue-600"
            >
              Submit Answers
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleNext}
              disabled={!currentAnswered || isSubmitting}
              className="bg-info hover:bg-blue-600"
            >
              Next
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}

/**
 * Review panel component for approve/reject actions.
 */
function ReviewPanel({
  stageName,
  onApprove,
  onReject,
  isSubmitting,
}: {
  stageName: string;
  onApprove: () => void;
  onReject: (feedback: string) => void;
  isSubmitting: boolean;
}) {
  const [feedback, setFeedback] = useState("");

  const handleReject = () => {
    if (feedback.trim()) {
      onReject(feedback.trim());
      setFeedback("");
    }
  };

  return (
    <Panel accent="warning" autoFill={false} padded={true}>
      <div className="text-sm font-medium text-warning mb-3">
        {capitalizeFirst(stageName)} Review
      </div>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Leave feedback to request changes..."
        className="w-full px-3 py-2 text-sm border border-stone-300 rounded-panel-sm focus:outline-none focus:ring-2 focus:ring-warning resize-none mb-3 text-stone-800"
        rows={2}
      />
      {feedback.trim() ? (
        <Button
          onClick={handleReject}
          disabled={isSubmitting}
          loading={isSubmitting}
          fullWidth
          className="bg-warning hover:bg-amber-600 text-white"
        >
          Request Changes
        </Button>
      ) : (
        <Button
          onClick={onApprove}
          disabled={isSubmitting}
          loading={isSubmitting}
          fullWidth
          className="bg-success hover:bg-emerald-600 text-white"
        >
          Approve
        </Button>
      )}
    </Panel>
  );
}

/**
 * Iteration card component for iterations tab.
 */
function IterationCard({ iteration }: { iteration: WorkflowIteration }) {
  const isActive = !iteration.outcome;
  const outcomeInfo = formatOutcome(iteration.outcome);

  return (
    <div
      className={`border rounded-panel-sm overflow-hidden ${
        isActive ? "border-sage-300 bg-sage-50" : "border-stone-200 bg-white"
      }`}
    >
      <div className="px-3 py-2 flex items-center justify-between border-b border-stone-100">
        <div className="flex items-center gap-2">
          <span className={`font-medium ${isActive ? "text-sage-700" : "text-stone-800"}`}>
            {capitalizeFirst(iteration.stage)} #{iteration.iteration_number}
          </span>
          {isActive && (
            <span className="flex items-center gap-1 text-xs text-sage-600">
              <span className="w-1.5 h-1.5 bg-sage-500 rounded-full animate-pulse" />
              Active
            </span>
          )}
        </div>
        <span className="text-xs text-stone-500">{formatTimestamp(iteration.started_at)}</span>
      </div>
      <div className="px-3 py-2 space-y-2">
        {outcomeInfo && (
          <div className="flex items-center gap-2">
            <span className="text-stone-500 text-sm">Outcome:</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${outcomeInfo.color}`}>
              {outcomeInfo.label}
            </span>
          </div>
        )}
        {iteration.ended_at && (
          <div className="text-xs text-stone-400">Ended: {formatTimestamp(iteration.ended_at)}</div>
        )}
      </div>
    </div>
  );
}

export function WorkflowTaskDetailSidebar({
  task,
  config,
  onClose,
  onTaskUpdated,
}: WorkflowTaskDetailSidebarProps) {
  const [activeTab, setActiveTab] = useState("details");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [iterations, setIterations] = useState<WorkflowIteration[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  // Track whether auto-scroll is enabled (user is "following" the logs)
  const isAutoScrollEnabledRef = useRef(true);

  const { approve, reject, answerQuestions, retry } = useWorkflowActions();
  const { getIterations, getLogs, getStagesWithLogs, getPendingQuestions } = useWorkflowQueries();

  // Pending questions (fetched from iteration outcome)
  const [pendingQuestions, setPendingQuestions] = useState<WorkflowQuestion[]>([]);

  // Stage tabs for logs
  const [stagesWithLogs, setStagesWithLogs] = useState<string[]>([]);
  const [activeLogStage, setActiveLogStage] = useState<string | null>(null);

  // Build tabs from task in consistent order
  const tabs = useMemo(() => buildTabs(task, config), [task, config]);

  // Get current artifact for artifact tab
  const currentTab = tabs.find((t) => t.id === activeTab);
  const currentArtifact =
    currentTab?.type === "artifact" && currentTab.artifactName
      ? task.artifacts[currentTab.artifactName]
      : null;

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

  // Fetch pending questions when task is in awaiting_review phase
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

  // Error state for logs
  const [logsError, setLogsError] = useState<string | null>(null);

  // Fetch stages with logs when switching to logs tab
  useEffect(() => {
    if (activeTab !== "logs") return;

    // Clear any previous error when entering logs tab
    setLogsError(null);

    const fetchStages = async () => {
      try {
        const stages = await getStagesWithLogs(task.id);
        setStagesWithLogs(stages);

        // Auto-select current stage if available, otherwise last stage
        // Note: We use a callback to avoid needing activeLogStage in dependencies
        setActiveLogStage((current) => {
          if (current) return current; // Already selected
          if (stages.length === 0) return null;

          const currentStage = getTaskStage(task.status);
          if (currentStage && stages.includes(currentStage)) {
            return currentStage;
          }
          return stages[stages.length - 1];
        });
      } catch (err) {
        console.error("Failed to fetch stages with logs:", err);
        setStagesWithLogs([]);
        setLogsError("Failed to load session stages");
      }
    };

    fetchStages();
  }, [activeTab, task.id, task.status, getStagesWithLogs]);

  // Fetch logs for active stage with race condition protection
  const fetchLogs = useCallback(async () => {
    if (!activeLogStage) return;

    // Capture the stage we're fetching for to detect race conditions
    const stageToFetch = activeLogStage;

    setLogsLoading(true);
    setLogsError(null);
    try {
      const result = await getLogs(task.id, stageToFetch);
      // Only update state if the stage hasn't changed during the fetch
      setActiveLogStage((currentStage) => {
        if (currentStage === stageToFetch) {
          setLogs(result);
        }
        return currentStage;
      });
    } catch (err) {
      console.error("Failed to fetch logs:", err);
      setActiveLogStage((currentStage) => {
        if (currentStage === stageToFetch) {
          setLogs([]);
          setLogsError("Failed to load session logs");
        }
        return currentStage;
      });
    } finally {
      setLogsLoading(false);
    }
  }, [task.id, activeLogStage, getLogs]);

  // Fetch logs when tab is active and stage is selected
  useEffect(() => {
    if (activeTab !== "logs" || !activeLogStage) return;

    // Initial fetch
    fetchLogs();

    // Poll while agent is running on current stage (but not if there's an error)
    const currentStage = getTaskStage(task.status);
    const shouldPoll =
      task.phase === "agent_working" && activeLogStage === currentStage && !logsError;

    if (shouldPoll) {
      const interval = setInterval(fetchLogs, 2000);
      return () => clearInterval(interval);
    }

    // Return empty cleanup when not polling
    return undefined;
  }, [activeTab, activeLogStage, task.phase, task.status, fetchLogs, logsError]);

  // Check if scroll container is at or near the bottom
  const isAtBottom = useCallback((container: HTMLElement): boolean => {
    // Threshold in pixels - allows for minor scroll jitter without disabling auto-scroll
    const threshold = 30;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceFromBottom <= threshold;
  }, []);

  // Handle scroll events to detect when user scrolls away from bottom
  const handleLogsScroll = useCallback(() => {
    const container = logsContainerRef.current;
    if (!container) return;

    // Update auto-scroll state based on whether user is at bottom
    isAutoScrollEnabledRef.current = isAtBottom(container);
  }, [isAtBottom]);

  // Auto-scroll logs to bottom when new entries arrive (only if user is following)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional scroll when logs change
  useEffect(() => {
    if (activeTab === "logs" && logsContainerRef.current && isAutoScrollEnabledRef.current) {
      const container = logsContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, [logs, activeTab]);

  // Reset tab when task changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset when task.id changes
  useEffect(() => {
    setActiveTab("details");
    setActiveLogStage(null);
    setStagesWithLogs([]);
    setLogsError(null);
    setLogs([]);
    isAutoScrollEnabledRef.current = true;
  }, [task.id]);

  // Validate active tab exists
  useEffect(() => {
    if (!tabs.find((t) => t.id === activeTab)) {
      setActiveTab("details");
    }
  }, [tabs, activeTab]);

  // Check review state
  const taskNeedsReview = needsReview(task);
  const taskHasQuestions = pendingQuestions.length > 0;
  const currentStage = getTaskStage(task.status);

  // Get current stage config for review label
  const currentStageConfig = currentStage
    ? config.stages.find((s) => s.name === currentStage)
    : null;

  // Handlers
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

  // Status badge variant
  const statusBadgeVariant =
    task.status.type === "done"
      ? "success"
      : task.status.type === "failed"
        ? "error"
        : task.status.type === "blocked"
          ? "blocked"
          : "neutral";

  const statusLabel =
    task.status.type === "active"
      ? capitalizeFirst(task.status.stage)
      : task.status.type === "waiting_on_children"
        ? "Waiting"
        : capitalizeFirst(task.status.type);

  // Determine which footer panel to show
  const footerPanelKey = taskHasQuestions
    ? "questions"
    : taskNeedsReview && currentStage
      ? "review"
      : null;

  return (
    <PanelContainer direction="vertical">
      <Panel>
        <PanelContainer direction="vertical" padded={true}>
          {/* Header */}
          {/* Top row: Title and close button */}
          <div className="flex flex-col items-stretch pt-1 pb-2 px-2">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-heading font-semibold text-lg text-stone-800 line-clamp-1">
                {task.title}
              </h2>
              <Panel.CloseButton onClick={onClose} />
            </div>
            {/* Bottom row: ID and badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm text-stone-500">{task.id}</span>
              <Badge variant={statusBadgeVariant}>{statusLabel}</Badge>
              {taskHasQuestions && <Badge variant="info">Questions</Badge>}
              {taskNeedsReview && <Badge variant="warning">Review</Badge>}
            </div>
          </div>

          {/* Tab Bar */}
          <TabbedPanel
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={(tabId) => setActiveTab(tabId)}
            padded={true}
          >
            {/* Details Tab */}
            {activeTab === "details" && (
              <div className="flex-1 overflow-auto p-4">
                {task.description && <p className="text-stone-600 text-sm">{task.description}</p>}
                {task.status.type === "failed" && (
                  <div className="mt-3 space-y-3">
                    {task.status.error && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-panel-sm">
                        <div className="text-xs font-medium text-error mb-1">Error</div>
                        <p className="text-sm text-red-800">{task.status.error}</p>
                      </div>
                    )}
                    <Button
                      variant="destructive"
                      fullWidth
                      onClick={handleRetry}
                      disabled={isRetrying}
                      loading={isRetrying}
                    >
                      Retry Task
                    </Button>
                  </div>
                )}
                {task.status.type === "blocked" && task.status.reason && (
                  <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-panel-sm">
                    <div className="text-xs font-medium text-blocked mb-1">Blocked</div>
                    <p className="text-sm text-orange-800">{task.status.reason}</p>
                  </div>
                )}
              </div>
            )}

            {/* Artifact Tab */}
            {currentTab?.type === "artifact" && currentArtifact && (
              <div className="flex-1 overflow-auto p-4">
                <div className="text-xs text-stone-500 mb-2">
                  Stage: {currentArtifact.stage} | Iteration: {currentArtifact.iteration} |{" "}
                  {formatTimestamp(currentArtifact.created_at)}
                </div>
                <div className="prose prose-sm max-w-none prose-headings:text-stone-800 prose-p:text-stone-700 prose-li:text-stone-700 prose-code:bg-stone-100 prose-code:px-1 prose-code:rounded prose-pre:bg-stone-100 prose-pre:text-stone-800">
                  <ReactMarkdown>{currentArtifact.content}</ReactMarkdown>
                </div>
              </div>
            )}

            {/* Iterations Tab */}
            {activeTab === "iterations" && (
              <div className="flex-1 overflow-auto p-4">
                <div className="text-sm font-medium text-stone-700 mb-4">Activity</div>
                {iterations.length === 0 ? (
                  <div className="text-stone-500 text-sm">No iterations recorded yet.</div>
                ) : (
                  <div className="space-y-4">
                    {[...iterations]
                      .sort((a, b) => a.started_at.localeCompare(b.started_at))
                      .map((iteration) => (
                        <IterationCard key={iteration.id} iteration={iteration} />
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Logs Tab */}
            {activeTab === "logs" && (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Stage tab bar */}
                {stagesWithLogs.length > 0 && (
                  <div className="flex-shrink-0 flex gap-1 p-2 border-b border-stone-700 bg-stone-800">
                    {stagesWithLogs.map((stage) => {
                      const currentStage = getTaskStage(task.status);
                      const isCurrentStage = stage === currentStage;
                      const isActiveTab = activeLogStage === stage;

                      return (
                        <button
                          key={stage}
                          type="button"
                          onClick={() => {
                            if (stage !== activeLogStage) {
                              setLogsError(null);
                              setLogs([]);
                              setActiveLogStage(stage);
                              isAutoScrollEnabledRef.current = true;
                            }
                          }}
                          className={`px-3 py-1 text-xs rounded-panel-sm capitalize flex items-center gap-1.5 transition-colors ${
                            isActiveTab
                              ? "bg-sage-600 text-white"
                              : "bg-stone-700 text-stone-300 hover:bg-stone-600"
                          }`}
                        >
                          {stage}
                          {isCurrentStage && task.phase === "agent_working" && (
                            <span className="w-1.5 h-1.5 bg-sage-400 rounded-full animate-pulse" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Log list */}
                <div
                  ref={logsContainerRef}
                  onScroll={handleLogsScroll}
                  className="flex-1 overflow-auto p-4 bg-stone-900 font-mono text-sm"
                >
                  <LogList logs={logs} isLoading={logsLoading} error={logsError} />
                </div>
              </div>
            )}
          </TabbedPanel>
        </PanelContainer>
      </Panel>

      {/* Footer slot for Questions or Review panel */}
      <PanelSlot activeKey={footerPanelKey} direction="vertical">
        <PanelSlot.Panel panelKey="questions">
          <QuestionFormSection
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
  );
}
