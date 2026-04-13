//! Thin state switcher — picks the correct footer component based on task state.

import type { WorkflowTaskView } from "../../../../types/workflow";
import type { DrawerTabId } from "../drawerTabs";
import type { TaskDrawerState } from "../useTaskDrawerState";
import { ChatFooter } from "./ChatFooter";
import { DoneFooter } from "./DoneFooter";
import { FailedFooter } from "./FailedFooter";
import { InterruptedFooter } from "./InterruptedFooter";
import { LineCommentsFooter } from "./LineCommentsFooter";
import { RejectFooter } from "./RejectFooter";
import { ReviewFooter } from "./ReviewFooter";
import { WaitingFooter } from "./WaitingFooter";
import { WorkingFooter } from "./WorkingFooter";

// ============================================================================
// Types
// ============================================================================

interface DrawerFooterProps {
  task: WorkflowTaskView;
  activeTab: DrawerTabId;
  stageReviewType: "violet" | "teal";
  state: TaskDrawerState;
}

// ============================================================================
// Component
// ============================================================================

export function DrawerFooter({ task, activeTab, stageReviewType, state }: DrawerFooterProps) {
  const progress = task.derived.subtask_progress;

  if (task.derived.is_failed) {
    return (
      <FailedFooter
        retryInstructions={state.retryInstructions}
        onRetryInstructionsChange={state.setRetryInstructions}
        retryTextareaRef={state.retryTextareaRef}
        retrying={state.retrying}
        onRetry={state.handleRetry}
      />
    );
  }
  if (task.derived.is_blocked) {
    return (
      <FailedFooter
        retryInstructions={state.retryInstructions}
        onRetryInstructionsChange={state.setRetryInstructions}
        retryTextareaRef={state.retryTextareaRef}
        retrying={state.retrying}
        onRetry={state.handleRetry}
      />
    );
  }
  if (
    (task.derived.needs_review || task.derived.is_done) &&
    activeTab === "diff" &&
    state.draftComments.length > 0
  ) {
    return (
      <LineCommentsFooter
        draftCount={state.draftComments.length}
        guidance={state.lineCommentGuidance}
        onGuidanceChange={state.setLineCommentGuidance}
        loading={state.loading}
        error={state.lineCommentError}
        onSubmit={state.submitLineComments}
        onClear={state.clearDraftComments}
      />
    );
  }
  if (task.derived.is_chatting && (activeTab === "logs" || activeTab === "agent")) {
    return (
      <ChatFooter
        chatAgentActive={task.derived.chat_agent_active}
        onReturnToWork={state.handleReturnToWork}
        onApprove={state.handleApprove}
        loading={state.loading}
        canApprove={task.derived.needs_review}
        chatError={state.chatError}
      />
    );
  }
  if (activeTab !== "agent") {
    if (task.derived.needs_review && state.rejectMode) {
      return (
        <RejectFooter
          reviewVariant={stageReviewType}
          feedback={state.feedback}
          onFeedbackChange={state.setFeedback}
          feedbackRef={state.feedbackRef}
          loading={state.loading}
          onReject={state.handleReject}
          onExitRejectMode={state.exitRejectMode}
        />
      );
    }
    if (task.derived.needs_review) {
      return (
        <ReviewFooter
          reviewVariant={stageReviewType}
          loading={state.loading}
          onApprove={state.handleApprove}
          onEnterRejectMode={state.enterRejectMode}
        />
      );
    }
    if (task.derived.is_working && activeTab !== "logs") {
      return (
        <WorkingFooter interrupting={state.interrupting} onInterrupt={state.handleInterrupt} />
      );
    }
  }
  if (task.derived.is_interrupted) {
    return <InterruptedFooter resuming={state.resuming} onResume={state.handleResume} />;
  }
  if (task.derived.is_done) {
    return (
      <DoneFooter
        task={task}
        activeTab={activeTab}
        loading={state.loading}
        prTabState={state.prTabState}
        updateMode={state.updateMode}
        updateNotes={state.updateNotes}
        onUpdateNotesChange={state.setUpdateNotes}
        updateNotesRef={state.updateNotesRef}
        onRequestUpdate={state.handleRequestUpdate}
        onEnterUpdateMode={state.enterUpdateMode}
        onExitUpdateMode={state.exitUpdateMode}
        onMerge={state.handleMerge}
        onOpenPr={state.handleOpenPr}
        onArchive={state.handleArchive}
        onFixConflicts={state.handleFixConflicts}
        onAddressFeedback={state.handleAddressFeedback}
      />
    );
  }
  if (task.derived.is_waiting_on_children && progress) {
    return <WaitingFooter progress={progress} />;
  }

  return null;
}
