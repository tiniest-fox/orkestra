/**
 * Task detail sidebar for the workflow system.
 * Shows task details with dynamic artifact tabs based on task.artifacts.
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
      answer: answers[q.id] || "",
      answered_at: new Date().toISOString(),
    }));
    onSubmit(formattedAnswers);
  };

  const allAnswered = questions.every((q) => answers[q.id]?.trim());
  const currentQuestion = questions[currentIndex];
  const isFirstQuestion = currentIndex === 0;
  const isLastQuestion = currentIndex === questions.length - 1;
  const currentAnswered = currentQuestion && answers[currentQuestion.id]?.trim();

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
    <div className="p-4 bg-blue-50 border-t border-gray-200 flex flex-col">
      {/* Header with progress indicator */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-blue-800">Questions</div>
        <div className="text-xs text-blue-600">
          Question {currentIndex + 1} of {questions.length}
        </div>
      </div>

      {/* Scrollable question content */}
      <div className="overflow-auto max-h-[300px] mb-4">
        <div className="text-sm font-medium text-gray-900 mb-1">{currentQuestion.question}</div>
        {currentQuestion.context && (
          <div className="text-xs text-gray-500 mb-2">{currentQuestion.context}</div>
        )}
        {currentQuestion.options && currentQuestion.options.length > 0 ? (
          <div className="space-y-1">
            {currentQuestion.options.map((option) => (
              <label key={option.id} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={currentQuestion.id}
                  value={option.id}
                  checked={answers[currentQuestion.id] === option.id}
                  onChange={() =>
                    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: option.id }))
                  }
                  className="text-blue-600 mt-0.5"
                />
                <div>
                  <span className="text-sm">{option.label}</span>
                  {option.description && (
                    <span className="text-xs text-gray-500 ml-1">- {option.description}</span>
                  )}
                </div>
              </label>
            ))}
          </div>
        ) : (
          <textarea
            value={answers[currentQuestion.id] || ""}
            onChange={(e) =>
              setAnswers((prev) => ({ ...prev, [currentQuestion.id]: e.target.value }))
            }
            placeholder="Type your answer..."
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            rows={2}
          />
        )}
      </div>

      {/* Navigation controls */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handlePrevious}
          disabled={isFirstQuestion || isSubmitting}
          className="px-4 py-2 text-sm text-blue-600 hover:bg-blue-100 rounded-lg disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
        >
          Previous
        </button>

        {isLastQuestion ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !allAnswered}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {isSubmitting ? "Submitting..." : "Submit Answers"}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleNext}
            disabled={!currentAnswered || isSubmitting}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Next
          </button>
        )}
      </div>
    </div>
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
    <div className="p-4 bg-amber-50 border-t border-gray-200">
      <div className="text-sm font-medium text-amber-800 mb-3">
        {capitalizeFirst(stageName)} Review
      </div>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Leave feedback to request changes..."
        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none mb-3"
        rows={2}
      />
      {feedback.trim() ? (
        <button
          type="button"
          onClick={handleReject}
          disabled={isSubmitting}
          className="w-full px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
        >
          Request Changes
        </button>
      ) : (
        <button
          type="button"
          onClick={onApprove}
          disabled={isSubmitting}
          className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          Approve
        </button>
      )}
    </div>
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
      className={`border rounded-lg overflow-hidden ${
        isActive ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-white"
      }`}
    >
      <div className="px-3 py-2 flex items-center justify-between border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className={`font-medium ${isActive ? "text-blue-700" : "text-gray-900"}`}>
            {capitalizeFirst(iteration.stage)} #{iteration.iteration_number}
          </span>
          {isActive && (
            <span className="flex items-center gap-1 text-xs text-blue-600">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
              Active
            </span>
          )}
        </div>
        <span className="text-xs text-gray-500">{formatTimestamp(iteration.started_at)}</span>
      </div>
      <div className="px-3 py-2 space-y-2">
        {outcomeInfo && (
          <div className="flex items-center gap-2">
            <span className="text-gray-500 text-sm">Outcome:</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${outcomeInfo.color}`}>
              {outcomeInfo.label}
            </span>
          </div>
        )}
        {iteration.ended_at && (
          <div className="text-xs text-gray-400">Ended: {formatTimestamp(iteration.ended_at)}</div>
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

  // Auto-scroll logs to bottom when new entries arrive
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional scroll when logs change
  useEffect(() => {
    if (activeTab === "logs" && logsContainerRef.current) {
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

  // Status styling
  const statusLabel =
    task.status.type === "active"
      ? capitalizeFirst(task.status.stage)
      : task.status.type === "waiting_on_children"
        ? "Waiting"
        : capitalizeFirst(task.status.type);

  const statusColor =
    task.status.type === "done"
      ? "bg-green-100 text-green-700"
      : task.status.type === "failed"
        ? "bg-red-100 text-red-700"
        : task.status.type === "blocked"
          ? "bg-orange-100 text-orange-700"
          : "bg-blue-100 text-blue-700";

  return (
    <div className="w-1/2 flex-shrink-0 bg-white shadow-xl border-l border-gray-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200">
        {/* Top row: Title and close button */}
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-semibold text-lg text-gray-900 line-clamp-2">{task.title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <svg
              className="w-5 h-5 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        {/* Bottom row: ID and badges */}
        <div className="flex items-center gap-2 mt-2">
          <span className="font-mono text-sm text-gray-500">{task.id}</span>
          <span className={`px-2 py-0.5 text-xs rounded-full ${statusColor}`}>{statusLabel}</span>
          {taskHasQuestions && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">
              Questions
            </span>
          )}
          {taskNeedsReview && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700">
              Review
            </span>
          )}
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex-shrink-0 flex border-b border-gray-200 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === tab.id
                ? "bg-gray-100 text-gray-900 border-b-2 border-blue-500"
                : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
            }`}
          >
            {tab.label}
            {tab.id === "logs" && task.phase === "agent_working" && (
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Details Tab */}
        {activeTab === "details" && (
          <div className="flex-1 overflow-auto p-4">
            {task.description && <p className="text-gray-600 text-sm">{task.description}</p>}
            {task.status.type === "failed" && (
              <div className="mt-3 space-y-3">
                {task.status.error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded">
                    <div className="text-xs font-medium text-red-700 mb-1">Error</div>
                    <p className="text-sm text-red-800">{task.status.error}</p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={isRetrying}
                  className="w-full px-3 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {isRetrying ? "Retrying..." : "Retry Task"}
                </button>
              </div>
            )}
            {task.status.type === "blocked" && task.status.reason && (
              <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded">
                <div className="text-xs font-medium text-orange-700 mb-1">Blocked</div>
                <p className="text-sm text-orange-800">{task.status.reason}</p>
              </div>
            )}
          </div>
        )}

        {/* Artifact Tab */}
        {currentTab?.type === "artifact" && currentArtifact && (
          <div className="flex-1 overflow-auto p-4">
            <div className="text-xs text-gray-500 mb-2">
              Stage: {currentArtifact.stage} | Iteration: {currentArtifact.iteration} |{" "}
              {formatTimestamp(currentArtifact.created_at)}
            </div>
            <div className="prose prose-sm max-w-none prose-headings:text-gray-800 prose-p:text-gray-700 prose-li:text-gray-700 prose-code:bg-gray-100 prose-code:px-1 prose-code:rounded prose-pre:bg-gray-100 prose-pre:text-gray-800">
              <ReactMarkdown>{currentArtifact.content}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* Iterations Tab */}
        {activeTab === "iterations" && (
          <div className="flex-1 overflow-auto p-4">
            <div className="text-sm font-medium text-gray-700 mb-4">Activity</div>
            {iterations.length === 0 ? (
              <div className="text-gray-500 text-sm">No iterations recorded yet.</div>
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
              <div className="flex-shrink-0 flex gap-1 p-2 border-b border-gray-700 bg-gray-800">
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
                        }
                      }}
                      className={`px-3 py-1 text-xs rounded capitalize flex items-center gap-1.5 transition-colors ${
                        isActiveTab
                          ? "bg-blue-600 text-white"
                          : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      }`}
                    >
                      {stage}
                      {isCurrentStage && task.phase === "agent_working" && (
                        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Log list */}
            <div
              ref={logsContainerRef}
              className="flex-1 overflow-auto p-4 bg-gray-900 font-mono text-sm"
            >
              <LogList logs={logs} isLoading={logsLoading} error={logsError} />
            </div>
          </div>
        )}
      </div>

      {/* Question Form */}
      {taskHasQuestions && (
        <QuestionFormSection
          questions={pendingQuestions}
          onSubmit={handleAnswerQuestions}
          isSubmitting={isSubmitting}
        />
      )}

      {/* Review Panel */}
      {taskNeedsReview && currentStage && !taskHasQuestions && (
        <ReviewPanel
          stageName={currentStageConfig?.display_name || currentStage}
          onApprove={handleApprove}
          onReject={handleReject}
          isSubmitting={isSubmitting}
        />
      )}
    </div>
  );
}
