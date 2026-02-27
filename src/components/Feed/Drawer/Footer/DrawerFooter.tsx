//! Thin state switcher — picks the correct footer component based on task state.

import type { WorkflowQuestion, WorkflowTaskView } from "../../../../types/workflow";
import type { DrawerTabId } from "../drawerTabs";
import type { TaskDrawerState } from "../useTaskDrawerState";
import { DoneFooter } from "./DoneFooter";
import { FailedFooter } from "./FailedFooter";
import { InterruptedFooter } from "./InterruptedFooter";
import { QuestionsFooter } from "./QuestionsFooter";
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
  questions: WorkflowQuestion[];
  stageReviewType: "violet" | "teal";
  completionStage: string | null | undefined;
  state: TaskDrawerState;
}

// ============================================================================
// Component
// ============================================================================

export function DrawerFooter({
  task,
  activeTab,
  questions,
  stageReviewType,
  completionStage,
  state,
}: DrawerFooterProps) {
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
  if (task.derived.has_questions && activeTab === "questions") {
    return (
      <QuestionsFooter
        questions={questions}
        answeredCount={state.answeredCount}
        allAnswered={state.allAnswered}
        loading={state.loading}
        onSubmitAnswers={state.handleSubmitAnswers}
        submitRef={state.submitRef}
      />
    );
  }
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
  if (task.derived.is_interrupted) {
    return (
      <InterruptedFooter
        resumeMessage={state.resumeMessage}
        onResumeMessageChange={state.setResumeMessage}
        resumeTextareaRef={state.resumeTextareaRef}
        resuming={state.resuming}
        onResume={state.handleResume}
      />
    );
  }
  if (task.derived.is_working) {
    return <WorkingFooter interrupting={state.interrupting} onInterrupt={state.handleInterrupt} />;
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
        onAddressComments={state.handleAddressComments}
      />
    );
  }
  if (task.derived.is_waiting_on_children && progress) {
    return <WaitingFooter progress={progress} completionStage={completionStage} />;
  }

  return null;
}
