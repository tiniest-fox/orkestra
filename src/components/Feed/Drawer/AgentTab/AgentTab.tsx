// Unified agent tab — streaming log timeline with inline artifact and question cards.

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "../../../../hooks/useIsMobile";
import { useOptimisticMessage } from "../../../../hooks/useOptimisticMessage";
import type { LogEntry, WorkflowQuestion, WorkflowTaskView } from "../../../../types/workflow";
import { titleCase } from "../../../../utils/titleCase";
import { Button } from "../../../ui/Button";
import { ChatComposeArea } from "../../ChatComposeArea";
import { FeedLogList } from "../../FeedLogList";
import type { ArtifactContext } from "../../MessageList";
import type { TaskDrawerState } from "../useTaskDrawerState";
import { InlineQuestionsCard } from "./InlineQuestionsCard";

// ============================================================================
// Types
// ============================================================================

interface AgentTabProps {
  task: WorkflowTaskView;
  logs: LogEntry[];
  logsError: unknown;
  state: TaskDrawerState;
  logContainerRef: React.RefCallback<HTMLDivElement>;
}

// ============================================================================
// Component
// ============================================================================

export function AgentTab({ task, logs, logsError, state, logContainerRef }: AgentTabProps) {
  const { derived } = task;
  const isGateRunning = task.state.type === "gate_running";
  const isMobile = useIsMobile();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Selected destination for vibe exit override picker.
  const [selectedVibeDestination, setSelectedVibeDestination] = useState<string>(
    () => derived.vibe_proposed_destination ?? derived.vibe_valid_destinations[0] ?? "",
  );

  // Reset picker when the proposed destination changes (new vibe exit proposal).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset when proposed destination changes
  useEffect(() => {
    setSelectedVibeDestination(
      derived.vibe_proposed_destination ?? derived.vibe_valid_destinations[0] ?? "",
    );
  }, [derived.vibe_proposed_destination]);

  // Combine the external logContainerRef (which sets logScrollRef for hotkey
  // scrolling in TaskDrawer) with our local ref for InlineQuestionsCard scroll-into-view.
  const combinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      (scrollContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      logContainerRef(node);
    },
    [logContainerRef],
  );

  // The latest artifact in the log — only this one gets approve/questions actions.
  const latestArtifactId = useMemo(() => {
    for (let i = logs.length - 1; i >= 0; i--) {
      const entry = logs[i];
      if (entry.type === "artifact_produced") return entry.artifact_id;
    }
    return undefined;
  }, [logs]);

  // Gate entries that follow the latest artifact — absorbed into the artifact card.
  const gateInfo = useMemo(() => {
    let artifactIdx = -1;
    for (let i = logs.length - 1; i >= 0; i--) {
      if (logs[i].type === "artifact_produced") {
        artifactIdx = i;
        break;
      }
    }
    if (artifactIdx === -1) return undefined;

    const entries: LogEntry[] = [];
    for (let i = artifactIdx + 1; i < logs.length; i++) {
      const e = logs[i];
      if (e.type === "gate_started" || e.type === "gate_output" || e.type === "gate_completed") {
        entries.push(e);
      }
    }
    if (entries.length === 0) return undefined;

    const completed = entries.find(
      (e): e is Extract<LogEntry, { type: "gate_completed" }> => e.type === "gate_completed",
    );
    return {
      entries,
      isRunning: !completed,
      passed: completed?.passed ?? false,
    };
  }, [logs]);

  // Derived verdict state
  const verdict = derived.pending_rejection
    ? ("rejected" as const)
    : derived.pending_approval
      ? ("approved" as const)
      : undefined;
  const rejection = derived.pending_rejection;
  const rejectionTarget =
    rejection && rejection.target !== rejection.from_stage ? rejection.target : undefined;

  // Destructure specific state/task fields for stable memo deps.
  // Callbacks from useTaskDrawerState are useCallback-wrapped and referentially stable.
  const {
    answers,
    setAnswer,
    handleSubmitAnswers,
    loading,
    submitRef,
    answeredCount,
    allAnswered,
    handleApprove,
    handleConfirmVibeExit,
    handleEnterVibe,
  } = state;
  const taskId = task.id;
  const pendingQuestions = task.derived.pending_questions;

  // Build context passed to AgentEntry for the latest artifact entry.
  const artifactContext = useMemo((): ArtifactContext | undefined => {
    if (!latestArtifactId) return undefined;

    const questionsElement =
      derived.has_questions && pendingQuestions.length > 0
        ? buildQuestionsElement(
            taskId,
            pendingQuestions,
            answers,
            setAnswer,
            handleSubmitAnswers,
            loading,
            submitRef,
            scrollContainerRef,
            answeredCount,
            allAnswered,
          )
        : undefined;

    const actions = buildArtifactActions(
      derived.needs_review,
      verdict,
      rejectionTarget,
      handleApprove,
      loading,
      handleEnterVibe,
      derived.is_vibing,
    );

    return {
      actions,
      questionsElement,
      gateEntries: gateInfo?.entries,
      isGateRunning: gateInfo?.isRunning,
      gatePassed: gateInfo?.passed,
    };
  }, [
    latestArtifactId,
    derived.has_questions,
    derived.needs_review,
    derived.is_vibing,
    pendingQuestions,
    taskId,
    answers,
    setAnswer,
    handleSubmitAnswers,
    loading,
    submitRef,
    answeredCount,
    allAnswered,
    handleApprove,
    handleEnterVibe,
    verdict,
    rejectionTarget,
    gateInfo,
  ]);

  // Input bar visibility:
  // Show when working, interrupted, failed, blocked, awaiting_question_answer, or needs_review.
  // send_message supports: AwaitingQuestionAnswer, AwaitingApproval, AwaitingRejectionConfirmation,
  // Failed, Blocked, Interrupted.
  const showInputBar =
    derived.is_working ||
    isGateRunning ||
    derived.has_questions ||
    derived.is_interrupted ||
    derived.is_failed ||
    derived.is_blocked ||
    derived.needs_review;

  // Input bar agent active state:
  // Working → treat as agentActive (shows stop, disables textarea)
  // All other states → not active (user can type and send)
  const inputAgentActive = derived.is_working || isGateRunning;

  const onInterruptOrStop = state.handleInterrupt;

  const {
    optimisticMessage,
    setOptimisticMessage,
    scrollTrigger: sendTrigger,
    triggerScroll,
  } = useOptimisticMessage(logs, state.messageError);

  const handleSend = useCallback(() => {
    triggerScroll();
    const msg = state.message.trim();
    if (msg) setOptimisticMessage(msg);
    state.handleSendMessage();
  }, [state.handleSendMessage, state.message, triggerScroll, setOptimisticMessage]);

  const showVibeExitCard =
    derived.is_vibing && derived.needs_review && derived.vibe_proposed_destination !== null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Vibe mode indicator — shown when actively vibing (not in review) */}
      {derived.is_vibing && derived.is_working && (
        <div className={`shrink-0 ${isMobile ? "px-2" : "px-6"} pt-3`}>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-accent/10 border border-accent/20">
            <span className="text-forge-mono-sm font-medium text-accent">Vibe mode active</span>
          </div>
        </div>
      )}

      {/* Vibe exit review card — shown when agent proposes an exit destination */}
      {showVibeExitCard && (
        <VibeExitCard
          proposedDestination={derived.vibe_proposed_destination as string}
          validDestinations={derived.vibe_valid_destinations}
          selectedDestination={selectedVibeDestination}
          onDestinationChange={setSelectedVibeDestination}
          onConfirm={() => handleConfirmVibeExit(selectedVibeDestination)}
          loading={loading}
          isMobile={isMobile}
        />
      )}

      {/* Log timeline — containerRef enables auto-scroll and hotkey scrolling */}
      <FeedLogList
        logs={logs}
        error={logsError}
        isAgentRunning={derived.is_working || isGateRunning || !!optimisticMessage}
        artifactContext={artifactContext}
        latestArtifactId={latestArtifactId}
        taskResources={task.resources}
        containerRef={combinedRef}
        initialLabel={`Starting "${titleCase(derived.current_stage ?? task.derived.stages_with_logs[task.derived.stages_with_logs.length - 1]?.stage ?? "")}"\u2026`}
        scrollToBottomTrigger={sendTrigger}
        pendingMessage={optimisticMessage ?? undefined}
      />

      {/* Input bar */}
      {showInputBar && (
        <ChatComposeArea
          value={state.message}
          onChange={state.setMessage}
          textareaRef={state.messageTextareaRef}
          sending={state.messageSending}
          agentActive={inputAgentActive}
          onSend={handleSend}
          onStop={onInterruptOrStop}
          placeholder={
            derived.is_interrupted
              ? "Add instructions and resume\u2026"
              : derived.is_failed
                ? "Send instructions to retry\u2026"
                : derived.is_blocked
                  ? "Send instructions to unblock\u2026"
                  : "Message the agent\u2026"
          }
          error={state.messageError}
          className={`shrink-0 ${isMobile ? "px-2" : "px-6"} pb-4 bg-canvas`}
        />
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

/** Build the inline questions element for the latest artifact position. */
function buildQuestionsElement(
  taskId: string,
  pendingQuestions: WorkflowQuestion[],
  answers: string[],
  setAnswer: (index: number, value: string) => void,
  handleSubmitAnswers: (questions: WorkflowQuestion[]) => Promise<void>,
  loading: boolean,
  submitRef: React.RefObject<HTMLButtonElement>,
  scrollContainerRef: React.RefObject<HTMLDivElement>,
  answeredCount: number,
  allAnswered: boolean,
): React.ReactNode {
  return (
    <InlineQuestionsCard
      taskId={taskId}
      questions={pendingQuestions}
      answers={answers}
      setAnswer={setAnswer}
      onSubmitAnswers={handleSubmitAnswers}
      loading={loading}
      submitRef={submitRef}
      scrollContainerRef={scrollContainerRef}
      answeredCount={answeredCount}
      allAnswered={allAnswered}
    />
  );
}

// ============================================================================
// VibeExitCard
// ============================================================================

interface VibeExitCardProps {
  proposedDestination: string;
  validDestinations: string[];
  selectedDestination: string;
  onDestinationChange: (v: string) => void;
  onConfirm: () => void;
  loading: boolean;
  isMobile: boolean;
}

/** Card shown when the vibe agent proposes exiting to a stage. */
function VibeExitCard({
  proposedDestination,
  validDestinations,
  selectedDestination,
  onDestinationChange,
  onConfirm,
  loading,
  isMobile,
}: VibeExitCardProps) {
  return (
    <div className={`shrink-0 ${isMobile ? "px-2" : "px-6"} pt-3 pb-2`}>
      <div className="rounded-panel-sm border border-border bg-surface p-3 flex flex-col gap-3">
        <div className="text-forge-body text-text-secondary">
          Agent proposes exiting to:{" "}
          <span className="font-medium text-text-primary">{proposedDestination}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedDestination}
            onChange={(e) => onDestinationChange(e.target.value)}
            disabled={loading}
            className="flex-1 min-w-0 font-sans text-forge-body text-text-primary bg-surface-2 border border-border rounded px-2 py-1.5 focus:outline-none focus:border-text-tertiary transition-colors"
          >
            {validDestinations.map((dest) => (
              <option key={dest} value={dest}>
                {dest}
              </option>
            ))}
          </select>
          <Button variant="primary" size="sm" onClick={onConfirm} disabled={loading}>
            {loading ? "Confirming…" : "Confirm Exit"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Build the approve/reject/vibe actions object for the latest artifact, or undefined if not in review. */
function buildArtifactActions(
  needsReview: boolean,
  verdict: "approved" | "rejected" | undefined,
  rejectionTarget: string | undefined,
  onApprove: () => Promise<void>,
  loading: boolean,
  onVibe: (() => Promise<void>) | undefined,
  isVibing: boolean,
): ArtifactContext["actions"] {
  if (!needsReview) return undefined;
  return {
    needsReview: true,
    verdict,
    rejectionTarget,
    onApprove,
    onVibe: isVibing ? undefined : onVibe,
    loading,
  };
}
