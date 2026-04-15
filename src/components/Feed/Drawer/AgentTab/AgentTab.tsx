// Unified agent tab — streaming log timeline with inline artifact and question cards.

import type React from "react";
import { useCallback, useMemo, useRef } from "react";
import type { LogEntry, WorkflowQuestion, WorkflowTaskView } from "../../../../types/workflow";
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
  handleLogScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

// ============================================================================
// Component
// ============================================================================

export function AgentTab({
  task,
  logs,
  logsError,
  state,
  logContainerRef,
  handleLogScroll,
}: AgentTabProps) {
  const { derived } = task;
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Combine the external logContainerRef (which sets logScrollRef for hotkeys
  // and registers with useAutoScroll from TaskDrawer) with our local ref for
  // NavigationScope / InlineQuestionsCard scroll-into-view.
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
    );

    return { actions, questionsElement };
  }, [
    latestArtifactId,
    derived.has_questions,
    derived.needs_review,
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
    verdict,
    rejectionTarget,
  ]);

  // Fallback approve bar: review state but no artifact_produced entry in the log.
  const lastAgentExtra =
    derived.needs_review && !latestArtifactId ? (
      <ApproveBar onApprove={state.handleApprove} loading={state.loading} />
    ) : undefined;

  // Input bar visibility:
  // Show when working, review, or chatting.
  // Hide when interrupted (InterruptedFooter in DrawerFooter handles that state),
  // questions (answered inline), failed, blocked, done.
  const showInputBar = derived.is_working || derived.needs_review || derived.is_chatting;

  // Input bar agent active state:
  // Working → treat as agentActive (shows stop, disables textarea)
  // Chat mode → follow chat_agent_active
  // Review/interrupted → not active (user can type and send)
  const inputAgentActive = derived.is_working || derived.chat_agent_active;

  const onInterruptOrStop = derived.chat_agent_active
    ? state.handleChatStop
    : state.handleInterrupt;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Virtualized timeline — containerRef enables Virtua */}
      <FeedLogList
        logs={logs}
        error={logsError}
        isAgentRunning={derived.is_working || derived.chat_agent_active}
        artifacts={task.artifacts}
        artifactContext={artifactContext}
        latestArtifactId={latestArtifactId}
        taskResources={task.resources}
        lastAgentExtra={lastAgentExtra}
        containerRef={combinedRef}
        onScroll={handleLogScroll}
      />

      {/* Input bar */}
      {showInputBar && (
        <ChatComposeArea
          value={state.chatMessage}
          onChange={state.setChatMessage}
          textareaRef={state.chatTextareaRef}
          sending={state.chatSending}
          agentActive={inputAgentActive}
          onSend={state.handleSendChat}
          onStop={onInterruptOrStop}
          placeholder="Message the agent…"
          error={state.chatError}
          className="shrink-0 px-4 pt-0 pb-4"
        />
      )}
    </div>
  );
}

// ============================================================================
// ApproveBar (fallback when review but no artifact_produced log entry)
// ============================================================================

function ApproveBar({ onApprove, loading }: { onApprove: () => void; loading: boolean }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-t border-border">
      <Button variant="violet" onClick={onApprove} disabled={loading}>
        Approve
      </Button>
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

/** Build the approve/reject actions object for the latest artifact, or undefined if not in review. */
function buildArtifactActions(
  needsReview: boolean,
  verdict: "approved" | "rejected" | undefined,
  rejectionTarget: string | undefined,
  onApprove: () => Promise<void>,
  loading: boolean,
): ArtifactContext["actions"] {
  if (!needsReview) return undefined;
  return { needsReview: true, verdict, rejectionTarget, onApprove, loading };
}
