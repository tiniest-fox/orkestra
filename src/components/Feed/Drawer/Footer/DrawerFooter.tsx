//! Thin state switcher — picks the correct footer component based on task state.

import type { WorkflowTaskView } from "../../../../types/workflow";
import type { DrawerTabId } from "../drawerTabs";
import type { TaskDrawerState } from "../useTaskDrawerState";
import { DoneFooter } from "./DoneFooter";
import { FailedFooter } from "./FailedFooter";
import { LineCommentsFooter } from "./LineCommentsFooter";

// ============================================================================
// Types
// ============================================================================

interface DrawerFooterProps {
  task: WorkflowTaskView;
  activeTab: DrawerTabId;
  state: TaskDrawerState;
}

// ============================================================================
// Component
// ============================================================================

export function DrawerFooter({ task, activeTab, state }: DrawerFooterProps) {
  if (task.derived.is_failed || task.derived.is_blocked) {
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

  return null;
}
