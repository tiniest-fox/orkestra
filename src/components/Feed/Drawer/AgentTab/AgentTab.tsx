// Unified agent tab — streaming log timeline with inline artifact and question cards.

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LogEntry, WorkflowArtifact, WorkflowTaskView } from "../../../../types/workflow";
import { Button } from "../../../ui/Button";
import { ChatComposeArea } from "../../ChatComposeArea";
import { FeedLogList } from "../../FeedLogList";
import type { TaskDrawerState } from "../useTaskDrawerState";
import { InlineArtifactCard } from "./InlineArtifactCard";
import { InlineQuestionsCard } from "./InlineQuestionsCard";

// ============================================================================
// Types
// ============================================================================

interface AgentTabProps {
  task: WorkflowTaskView;
  logs: LogEntry[];
  logsError: unknown;
  artifact: WorkflowArtifact | null;
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
  artifact,
  state,
  logContainerRef,
  handleLogScroll,
}: AgentTabProps) {
  const { derived } = task;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const artifactCardRef = useRef<HTMLDivElement>(null);
  const [artifactReviewSeen, setArtifactReviewSeen] = useState(false);

  // Combine the external logContainerRef (which sets logScrollRef for hotkeys
  // and registers with useAutoScroll from TaskDrawer) with our local ref for
  // NavigationScope / scroll-into-view of the artifact card.
  const combinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      (scrollContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      logContainerRef(node);
    },
    [logContainerRef],
  );

  // When task transitions to review and artifact appears, scroll artifact into view.
  useEffect(() => {
    if (derived.needs_review && artifact && !artifactReviewSeen) {
      setArtifactReviewSeen(true);
      requestAnimationFrame(() => {
        artifactCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    if (!derived.needs_review) {
      setArtifactReviewSeen(false);
    }
  }, [derived.needs_review, artifact, artifactReviewSeen]);

  // Derived verdict state
  const verdict = derived.pending_rejection
    ? ("rejected" as const)
    : derived.pending_approval
      ? ("approved" as const)
      : undefined;
  const rejection = derived.pending_rejection;
  const rejectionTarget =
    rejection && rejection.target !== rejection.from_stage ? rejection.target : undefined;

  // Input bar visibility:
  // Show when working, review, chatting, or interrupted.
  // Hide when questions (answered inline), failed, blocked, done.
  const showInputBar =
    derived.is_working || derived.needs_review || derived.is_chatting || derived.is_interrupted;

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
      {/* Scrollable timeline */}
      <div ref={combinedRef} className="flex-1 overflow-y-auto" onScroll={handleLogScroll}>
        <FeedLogList
          logs={logs}
          error={logsError}
          isAgentRunning={derived.is_working || derived.chat_agent_active}
        />

        {/* Inline artifact card */}
        {artifact && (
          <div ref={artifactCardRef}>
            <InlineArtifactCard
              artifact={artifact}
              needsReview={derived.needs_review}
              verdict={verdict}
              rejectionTarget={rejectionTarget}
              onApprove={state.handleApprove}
              loading={state.loading}
            />
          </div>
        )}

        {/* Fallback approve bar: review state but no artifact */}
        {derived.needs_review && !artifact && (
          <ApproveBar onApprove={state.handleApprove} loading={state.loading} />
        )}

        {/* Inline questions */}
        {derived.has_questions && task.derived.pending_questions.length > 0 && (
          <InlineQuestionsCard
            task={task}
            questions={task.derived.pending_questions}
            answers={state.answers}
            setAnswer={state.setAnswer}
            onSubmitAnswers={state.handleSubmitAnswers}
            loading={state.loading}
            submitRef={state.submitRef}
            scrollContainerRef={scrollContainerRef}
            answeredCount={state.answeredCount}
            allAnswered={state.allAnswered}
          />
        )}
      </div>

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
// ApproveBar (fallback when review but no artifact)
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
